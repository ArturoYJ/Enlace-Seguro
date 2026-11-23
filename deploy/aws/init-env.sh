#!/usr/bin/env bash
# Crea deploy/aws/.env con secretos aleatorios. No sobrescribe un .env existente.
set -euo pipefail
cd "$(dirname "$0")"
if [ -e .env ]; then echo ".env ya existe; no se modifica." >&2; exit 1; fi
secret() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'; }
umask 077
cat > .env <<ENV
# ---- Rellena estos valores ----
# Subdominio de DuckDNS que apunta a la Elastic IP de la EC2.
DOMAIN=tu-subdominio.duckdns.org
# Cadena de conexión de MongoDB Atlas (Connect > Drivers). Debe ser mongodb+srv://, que usa TLS.
MONGODB_URI=mongodb+srv://USUARIO:CONTRASENA@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=enlaceseguro

# ---- Secretos generados (no los compartas ni los subas al repo) ----
SANDBOX_SERVICE_TOKEN=$(secret)
JWT_SECRET=$(secret)
LOGIN_RATE_LIMIT_HMAC_KEY=$(secret)
ANALYSIS_INPUT_ENCRYPTION_KEY=$(secret)

# ---- Opciones ----
ANALYSIS_JOB_MAX_PENDING=50
DAILY_ANALYSIS_QUOTA=5
TIMEZONE=America/Mexico_City
CORS_ALLOWED_ORIGINS=
# Demo de interacción con logins (envía datos inventados al sitio analizado).
SANDBOX_CREDENTIAL_PROBE_ENABLED=false
VIRUSTOTAL_ENABLED=false
# VIRUSTOTAL_API_KEY=
# VIRUSTOTAL_LOOKUP_MODE=domain
# VIRUSTOTAL_ALLOWLIST_JSON=[]
ENV
echo "Listo: edita deploy/aws/.env y cambia DOMAIN y MONGODB_URI."
