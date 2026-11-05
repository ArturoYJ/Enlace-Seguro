#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "A running Docker daemon is required." >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image="${MONGO_IMAGE:-mongo:8.0.34}"
if [[ ! "$image" =~ ^mongo:8\.0(\.[0-9]+)?$ ]]; then
  echo "Refusing non-MongoDB-8 image '$image'." >&2
  exit 2
fi

suffix="${GITHUB_RUN_ID:-local}_$$_${RANDOM}"
suffix="$(printf '%s' "$suffix" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
database_name="enlaceseguro_test_e2e_${suffix}"
container_name="enlaceseguro-mobile-e2e-${suffix}"
host_port="$(node -e 'const s=require("node:net").createServer(); s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();})')"
mongo_internal_uri="mongodb://127.0.0.1:${host_port}/${database_name}"
mongo_uri="${mongo_internal_uri}?replicaSet=rs0"

cleanup_on_error() {
  status=$?
  if (( status != 0 )); then docker rm -f "$container_name" >/dev/null 2>&1 || true; fi
  exit "$status"
}
trap cleanup_on_error EXIT

# Intentionally no volume; only the host loopback interface can reach MongoDB.
docker run --rm --detach \
  --name "$container_name" \
  --publish "127.0.0.1:${host_port}:${host_port}" \
  "$image" mongod --port "$host_port" --replSet rs0 --bind_ip_all >/dev/null

docker exec "$container_name" mkdir -p /tmp/enlaceseguro-mobile-e2e
docker cp "$repo_root/database" "$container_name:/tmp/enlaceseguro-mobile-e2e/"
mongo_eval() {
  docker exec --workdir /tmp/enlaceseguro-mobile-e2e "$container_name" \
    mongosh "$mongo_internal_uri" --quiet --eval "$1"
}

ready=false
for _ in $(seq 1 60); do
  if mongo_eval 'db.adminCommand({ping: 1}).ok' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Disposable MongoDB did not become ready." >&2
  docker logs "$container_name" >&2 || true
  exit 1
fi

mongo_eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:${host_port}'}]})"
primary=false
for _ in $(seq 1 60); do
  if mongo_eval 'db.hello().isWritablePrimary' 2>/dev/null | grep -q true; then primary=true; break; fi
  sleep 1
done
if [[ "$primary" != true ]]; then
  echo "Disposable MongoDB replica set did not elect a primary." >&2
  docker logs "$container_name" >&2 || true
  exit 1
fi

for migration in \
  001_create_mongodb_schema.js \
  002_create_login_rate_limit_buckets.js \
  003_encrypt_analysis_inputs.js \
  004_durable_analysis_jobs.js; do
  mongo_eval "globalThis.EnlaceSeguroExpectedDb='${database_name}'; load('/tmp/enlaceseguro-mobile-e2e/database/migrations/${migration}')"
done
mongo_eval "globalThis.EnlaceSeguroExpectedDb='${database_name}'; globalThis.EnlaceSeguroAnalysisJobMaxPending=100; load('/tmp/enlaceseguro-mobile-e2e/database/migrations/005_analysis_queue_capacity.js')"
mongo_eval "const q=db.analysis_queue_capacity.findOne({_id:'global'}); if (!q || q.pendingCount!==0 || q.maxPending!==100) throw new Error('maxPending must be 100 and queue empty');"
mongo_eval "globalThis.EnlaceSeguroExpectedDb='${database_name}'; load('/tmp/enlaceseguro-mobile-e2e/database/migrations/006_extend_analysis_history_retention_366_days.js')"

if [[ -n "${GITHUB_ENV:-}" ]]; then
  {
    printf 'MONGO_TEST_URI=%s\n' "$mongo_uri"
    printf 'MOBILE_E2E_MONGO_CONTAINER=%s\n' "$container_name"
  } >> "$GITHUB_ENV"
fi
if [[ -n "${MOBILE_E2E_ENV_FILE:-}" ]]; then
  {
    printf 'export MONGO_TEST_URI=%q\n' "$mongo_uri"
    printf 'export MOBILE_E2E_MONGO_CONTAINER=%q\n' "$container_name"
  } > "$MOBILE_E2E_ENV_FILE"
elif [[ -z "${GITHUB_ENV:-}" ]]; then
  printf 'MONGO_TEST_URI=%s\n' "$mongo_uri"
  printf 'MOBILE_E2E_MONGO_CONTAINER=%s\n' "$container_name"
fi
trap - EXIT
echo "Disposable MongoDB 8 replica set ready; database migrated 001–006 (maxPending=100, history TTL=366 days)."
