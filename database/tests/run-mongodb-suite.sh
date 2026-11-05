#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Requires Docker CLI." >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running; start it explicitly, then rerun." >&2
  exit 2
fi

image="${MONGO_IMAGE:-mongo:8.0.34}"
if [[ ! "$image" =~ ^mongo:8\.0(\.[0-9]+)?$ ]]; then
  echo "Refusing non-MongoDB-8 image '$image'. Set MONGO_IMAGE to a mongo:8.0.x image." >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container_name="enlaceseguro-mongo-smoke-$$"
database_name="enlaceseguro_test_$(date +%Y%m%d%H%M%S)_$$"

cleanup() {
  if docker inspect "$container_name" >/dev/null 2>&1; then
    docker stop "$container_name" >/dev/null
  fi
}
trap cleanup EXIT INT TERM

# Use one random port as both the container and host port so the replica-set
# member can advertise the exact address the host-side API tests can reach.
# No volume is attached; the published port is bound only to loopback.
host_port="$(node -e 'const server=require("node:net").createServer(); server.listen(0,"127.0.0.1",()=>{console.log(server.address().port); server.close();})')"
docker run --rm --detach \
  --name "$container_name" \
  --publish "127.0.0.1:${host_port}:${host_port}" \
  "$image" mongod --port "$host_port" --replSet rs0 --bind_ip_all >/dev/null

mongo_uri="mongodb://127.0.0.1:${host_port}/${database_name}?replicaSet=rs0"
mongo_internal_uri="mongodb://127.0.0.1:${host_port}/${database_name}"
mongo_eval() {
	docker exec --workdir /tmp/enlaceseguro-suite "$container_name" mongosh "$mongo_internal_uri" --quiet --eval "$1"
}
mongo_file() {
	docker exec --workdir /tmp/enlaceseguro-suite "$container_name" mongosh "$mongo_internal_uri" --quiet --file "$1"
}
# Use the matching mongosh bundled in the pinned MongoDB image; no host CLI install is required.
docker exec "$container_name" mkdir -p /tmp/enlaceseguro-suite
docker cp "$repo_root/database" "$container_name:/tmp/enlaceseguro-suite/"

ready=false
for _ in $(seq 1 60); do
  if mongo_eval 'db.adminCommand({ping: 1}).ok' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Disposable MongoDB container did not become ready." >&2
  docker logs "$container_name" >&2 || true
  exit 1
fi

# MongoDB transactions require replica-set semantics; this is one disposable
# member, but advertises the host-mapped loopback address used by API tests.
mongo_eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: '127.0.0.1:${host_port}'}]})"
primary=false
for _ in $(seq 1 60); do
  if mongo_eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true; then
    primary=true
    break
  fi
  sleep 1
done
if [[ "$primary" != true ]]; then
  echo "Disposable MongoDB replica set did not elect a primary." >&2
  docker logs "$container_name" >&2 || true
  exit 1
fi

# Model a partial bootstrap in a separate disposable DB. The migration must
# fail closed and preserve the existing collection/document; it must never drop it.
partial_db="${database_name}_partial"
partial_internal_uri="mongodb://127.0.0.1:${host_port}/${partial_db}"
docker exec --workdir /tmp/enlaceseguro-suite "$container_name" mongosh "$partial_internal_uri" --quiet --eval \
  "db.createCollection('users'); db.users.insertOne({_id: 'recovery-sentinel', state: 'preserved'});"
partial_output="$(docker exec --workdir /tmp/enlaceseguro-suite "$container_name" mongosh "$partial_internal_uri" --quiet --eval \
  "globalThis.EnlaceSeguroExpectedDb='${partial_db}'; load('/tmp/enlaceseguro-suite/database/migrations/001_create_mongodb_schema.js')" 2>&1 || true)"
if [[ "$partial_output" != *"Refusing to modify existing collections: users"* ]]; then
  echo "Expected bootstrap to refuse the simulated partial state; got: $partial_output" >&2
  exit 1
fi
docker exec --workdir /tmp/enlaceseguro-suite "$container_name" mongosh "$partial_internal_uri" --quiet --eval \
  "if (db.getCollectionNames().join(',') !== 'users') throw new Error('partial recovery test changed collection set'); if (db.users.findOne({_id: 'recovery-sentinel'}).state !== 'preserved') throw new Error('partial recovery test altered sentinel'); if (db.users.getIndexes().length !== 1) throw new Error('partial recovery test unexpectedly changed indexes'); print('PASS: partial bootstrap refuses to resume and preserves existing collection/data');"

mongo_eval "if (db.getCollectionNames().length !== 0) throw new Error('test DB is not empty'); globalThis.EnlaceSeguroExpectedDb='${database_name}'; load('/tmp/enlaceseguro-suite/database/migrations/001_create_mongodb_schema.js')"
mongo_eval "globalThis.EnlaceSeguroExpectedDb='${database_name}'; load('/tmp/enlaceseguro-suite/database/migrations/002_create_login_rate_limit_buckets.js')"
mongo_eval "globalThis.EnlaceSeguroExpectedDb='${database_name}'; load('/tmp/enlaceseguro-suite/database/migrations/002_create_login_rate_limit_buckets.js')" >/dev/null
mongo_eval "globalThis.EnlaceSeguroExpectedDb='${database_name}'; load('/tmp/enlaceseguro-suite/database/migrations/003_encrypt_analysis_inputs.js')"
mongo_eval "globalThis.EnlaceSeguroExpectedDb='${database_name}'; load('/tmp/enlaceseguro-suite/database/migrations/003_encrypt_analysis_inputs.js')" >/dev/null
mongo_eval "globalThis.EnlaceSeguroExpectedDb='${database_name}'; load('/tmp/enlaceseguro-suite/database/migrations/004_durable_analysis_jobs.js')"
mongo_eval "globalThis.EnlaceSeguroExpectedDb='${database_name}'; load('/tmp/enlaceseguro-suite/database/migrations/004_durable_analysis_jobs.js')" >/dev/null
mongo_eval "globalThis.EnlaceSeguroExpectedDb='${database_name}'; globalThis.EnlaceSeguroAnalysisJobMaxPending=1000; try { load('/tmp/enlaceseguro-suite/database/migrations/005_analysis_queue_capacity.js') } catch (error) { print(error.stack || error); throw error; }"
mongo_eval "globalThis.EnlaceSeguroExpectedDb='${database_name}'; globalThis.EnlaceSeguroAnalysisJobMaxPending=1000; load('/tmp/enlaceseguro-suite/database/migrations/005_analysis_queue_capacity.js')" >/dev/null
mongo_eval "globalThis.EnlaceSeguroExpectedDb='${database_name}'; load('/tmp/enlaceseguro-suite/database/tests/mongodb-analysis-retention-migration-tests.js')"
legacy_database_name="${database_name}_legacy"
docker exec --workdir /tmp/enlaceseguro-suite "$container_name" mongosh "mongodb://127.0.0.1:${host_port}/${legacy_database_name}" --quiet --eval \
  "globalThis.EnlaceSeguroExpectedDb='${legacy_database_name}'; globalThis.EnlaceSeguroAnalysisJobMaxPending=1000; load('/tmp/enlaceseguro-suite/database/migrations/001_create_mongodb_schema.js'); load('/tmp/enlaceseguro-suite/database/migrations/002_create_login_rate_limit_buckets.js'); load('/tmp/enlaceseguro-suite/database/migrations/003_encrypt_analysis_inputs.js'); load('/tmp/enlaceseguro-suite/database/tests/mongodb-durable-job-migration-tests.js')"
for integration_test in \
  AnalysisFlowHttp.integration.test.ts \
  LoginRateLimitHttp.integration.test.ts \
  MongoDailyAnalysisRepository.integration.test.ts \
  MongoLoginRateLimitRepository.integration.test.ts; do
  mongo_eval "db.daily_analyses.deleteMany({}); db.analysis_queue_capacity.updateOne({_id:'global'}, {\$set:{pendingCount:0, updatedAt:new Date()}}); db.login_rate_limit_buckets.deleteMany({})" >/dev/null
  (cd "$repo_root/api" && MONGO_TEST_URI="$mongo_uri" node --test --import tsx "tests/integration/$integration_test")
done
if [[ -n "${MONGO_EXPLAIN_REPORT_PATH:-}" ]]; then
  mkdir -p "$(dirname "$MONGO_EXPLAIN_REPORT_PATH")"
  mongo_file /tmp/enlaceseguro-suite/database/tests/mongodb-explain-tests.js > "$MONGO_EXPLAIN_REPORT_PATH"
  node - "$MONGO_EXPLAIN_REPORT_PATH" <<'NODE'
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify({
  suite: report.suite,
  database: report.database,
  version: report.version,
  synthetic: report.synthetic,
  explains: report.explains.map(({ pattern, keysExamined, docsExamined, cursorRowsReturned, pipelineRowsReturned, executionTimeMillis, winningExecutionStages, sortOrSpillStages }) => ({
    pattern, keysExamined, docsExamined, cursorRowsReturned, pipelineRowsReturned,
    executionTimeMillis, winningExecutionStages, sortOrSpillStages
  }))
}, null, 2));
console.log(`Full winning-plan evidence saved to ${process.argv[2]}`);
NODE
else
  mongo_file /tmp/enlaceseguro-suite/database/tests/mongodb-explain-tests.js
fi
mongo_file /tmp/enlaceseguro-suite/database/tests/mongodb-validation-matrix-tests.js
mongo_file /tmp/enlaceseguro-suite/database/tests/mongodb-smoke-tests.js
npm --prefix "$repo_root/api" run build
MONGO_TEST_URI="$mongo_uri" node --test "$repo_root/database/tests/mongodb-ttl-tests.js"

# Exercise a real logical backup/restore with the Database Tools bundled in the
# same disposable MongoDB 8 image. Restore into a distinct database and assert
# collection contents plus the indexes needed by the API; no persistent volume
# or host filesystem backup is used.
restore_db="${database_name}_restore"
restore_internal_uri="mongodb://127.0.0.1:${host_port}/${restore_db}"
archive_path="/tmp/${database_name}.archive.gz"
source_counts="$(mongo_eval 'JSON.stringify(Object.fromEntries(db.getCollectionNames().sort().map((name) => [name, db.getCollection(name).countDocuments()])))')"
docker exec --workdir /tmp/enlaceseguro-suite "$container_name" mongodump \
  --uri "$mongo_internal_uri" --archive="$archive_path" --gzip >/dev/null
docker exec --workdir /tmp/enlaceseguro-suite "$container_name" mongorestore \
  --uri "mongodb://127.0.0.1:${host_port}" --archive="$archive_path" --gzip \
  --nsFrom="${database_name}.*" --nsTo="${restore_db}.*" --stopOnError >/dev/null
restored_counts="$(docker exec --workdir /tmp/enlaceseguro-suite "$container_name" mongosh "$restore_internal_uri" --quiet --eval \
  'JSON.stringify(Object.fromEntries(db.getCollectionNames().sort().map((name) => [name, db.getCollection(name).countDocuments()])))')"
if [[ "$source_counts" != "$restored_counts" ]]; then
  echo "Backup/restore count mismatch: source=$source_counts restored=$restored_counts" >&2
  exit 1
fi
docker exec --workdir /tmp/enlaceseguro-suite "$container_name" mongosh "$restore_internal_uri" --quiet --eval \
  "const names = db.getCollectionNames().sort(); if (names.join(',') !== 'analysis_queue_capacity,daily_analyses,login_rate_limit_buckets,refresh_tokens,reputation_cache,security_audit_events,users') throw new Error('restore collection set differs'); if (!db.daily_analyses.getIndexes().some((i) => i.name === 'uq_daily_analyses_user_date')) throw new Error('daily unique index missing after restore'); if (!db.security_audit_events.getIndexes().some((i) => i.name === 'ttl_audit_purge_at')) throw new Error('audit TTL index missing after restore'); if (!db.login_rate_limit_buckets.getIndexes().some((i) => i.name === 'ttl_login_rate_limit_expires_at')) throw new Error('login rate-limit TTL index missing after restore'); if (db.analysis_queue_capacity.findOne({_id:'global'})?.pendingCount !== 0) throw new Error('queue singleton missing from restore'); print('PASS: disposable mongodump/mongorestore restored collection counts and API-critical indexes');"
echo "Disposable MongoDB integration, explain, validation matrix, smoke, TTL, and backup/restore suites passed; container will be removed by cleanup trap."
