#!/usr/bin/env bash
# Aplica las migraciones 001-006 a la base de MongoDB Atlas configurada en deploy/aws/.env.
# Solo para una base nueva: detiene la API mientras migra y la vuelve a arrancar al terminar.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Falta deploy/aws/.env (corre init-env.sh)." >&2; exit 1; }
docker compose stop api
# --env-file lee los valores tal cual (la URI de Atlas lleva & y ?, que romperían un "source").
docker run --rm --env-file .env -v "$PWD/../../database:/work/database:ro" -w /work mongo:8.0.34 bash -c '
  set -euo pipefail
  : "${MONGODB_URI:?}" "${MONGODB_DB_NAME:?}" "${ANALYSIS_JOB_MAX_PENDING:?}"
  for m in 001_create_mongodb_schema.js 002_create_login_rate_limit_buckets.js 003_encrypt_analysis_inputs.js \
           004_durable_analysis_jobs.js 005_analysis_queue_capacity.js 006_extend_analysis_history_retention_366_days.js; do
    echo "Aplicando $m"
    mongosh "$MONGODB_URI" --quiet --eval "db = db.getSiblingDB(\"$MONGODB_DB_NAME\"); globalThis.EnlaceSeguroExpectedDb = \"$MONGODB_DB_NAME\"; globalThis.EnlaceSeguroAnalysisJobMaxPending = $ANALYSIS_JOB_MAX_PENDING; load(\"database/migrations/$m\")"
  done'
docker compose start api
echo "Migraciones aplicadas a $(grep ^MONGODB_DB_NAME= .env | cut -d= -f2)."
