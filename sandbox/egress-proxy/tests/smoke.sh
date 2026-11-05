#!/usr/bin/env bash
set -Eeuo pipefail

# Synthetic, internal-only smoke test for sandbox/egress-proxy/envoy.yaml.
# This does not prove DNS rebinding resistance or host/cloud egress ACLs.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CONFIG_FILE="$ROOT_DIR/sandbox/egress-proxy/envoy.yaml"
ENVOY_IMAGE="envoyproxy/envoy:v1.40.2"
CURL_IMAGE="curlimages/curl:8.12.1"
CANARY_IMAGE="node:22-alpine"
RUN_ID="$(date +%s)-$$-${RANDOM}"
RESOURCE_PREFIX="enlaceseguro-egress-smoke-${RUN_ID}"
NETWORK_NAME="${RESOURCE_PREFIX}-internal"
ENVOY_NAME="${RESOURCE_PREFIX}-envoy"
CANARY_NAME="${RESOURCE_PREFIX}-canary"
VALIDATOR_NAME="${RESOURCE_PREFIX}-validator"
OWNED_CONTAINERS=("$VALIDATOR_NAME" "$ENVOY_NAME" "$CANARY_NAME")
ACTIVE_CLIENT_NAME=""
NETWORK_CREATED=0
PROXY_OUTPUT=""
PROXY_EXIT_CODE=0

cleanup() {
  local name
  if [[ -n "$ACTIVE_CLIENT_NAME" ]]; then
    docker rm -f "$ACTIVE_CLIENT_NAME" >/dev/null 2>&1 || true
  fi
  for name in "${OWNED_CONTAINERS[@]}"; do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
  if [[ "$NETWORK_CREATED" == 1 ]]; then
    docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

require_command docker
[[ -f "$CONFIG_FILE" ]] || fail "Envoy config not found: $CONFIG_FILE"

printf 'Validating config with pinned image %s\n' "$ENVOY_IMAGE"
docker run --rm \
  --name "$VALIDATOR_NAME" \
  -v "$CONFIG_FILE:/etc/envoy/envoy.yaml:ro" \
  "$ENVOY_IMAGE" --mode validate -c /etc/envoy/envoy.yaml

docker network create --internal --label "enlaceseguro.smoke.run=${RUN_ID}" "$NETWORK_NAME" >/dev/null
NETWORK_CREATED=1
[[ "$(docker network inspect --format '{{.Internal}}' "$NETWORK_NAME")" == true ]] || fail 'Docker network is not internal.'

printf 'Starting private synthetic canary on internal network %s\n' "$NETWORK_NAME"
docker run -d --rm \
  --name "$CANARY_NAME" \
  --network "$NETWORK_NAME" \
  --network-alias private-canary \
  "$CANARY_IMAGE" \
  node -e 'require("node:http").createServer((req,res)=>{console.log("CANARY_REQUEST "+req.url);res.writeHead(200,{"content-type":"text/plain"});res.end("synthetic-canary")}).listen(80,"0.0.0.0",()=>console.log("CANARY_READY"))' >/dev/null

printf 'Starting Envoy with no published host ports\n'
docker run -d --rm \
  --name "$ENVOY_NAME" \
  --network "$NETWORK_NAME" \
  --network-alias egress-proxy \
  -v "$CONFIG_FILE:/etc/envoy/envoy.yaml:ro" \
  "$ENVOY_IMAGE" -c /etc/envoy/envoy.yaml >/dev/null

run_request() {
  local url="$1"
  local name="${RESOURCE_PREFIX}-client-${RANDOM}-${RANDOM}"
  ACTIVE_CLIENT_NAME="$name"
  set +e
  PROXY_OUTPUT="$(docker run --rm --name "$name" --network "$NETWORK_NAME" "$CURL_IMAGE" \
    --silent --show-error --max-time 8 --dump-header - --output /dev/null \
    --proxy http://egress-proxy:10000 "$url" 2>&1)"
  PROXY_EXIT_CODE=$?
  set -e
  ACTIVE_CLIENT_NAME=""
}

assert_local_error() {
  local label="$1" url="$2" expected_status="$3"
  run_request "$url"
  if ! grep -Eiq "^HTTP/[0-9.]+ ${expected_status}([[:space:]]|$)" <<<"$PROXY_OUTPUT"; then
    printf '%s\n' "$PROXY_OUTPUT" >&2
    fail "$label expected HTTP $expected_status."
  fi
  if ! grep -Eiq '^x-enlaceseguro-egress-error:[[:space:]]*true[[:space:]]*$' <<<"$PROXY_OUTPUT"; then
    printf '%s\n' "$PROXY_OUTPUT" >&2
    fail "$label missing Envoy local-error marker."
  fi
  [[ "$PROXY_EXIT_CODE" == 0 || "$url" == https://* ]] || fail "$label curl failed unexpectedly (exit $PROXY_EXIT_CODE)."
  printf 'PASS: %s -> HTTP %s with local-error marker\n' "$label" "$expected_status"
}

wait_for_envoy() {
  local attempt
  for attempt in $(seq 1 30); do
    run_request 'http://127.0.0.1:80/smoke-readiness'
    if grep -Eiq '^x-enlaceseguro-egress-error:[[:space:]]*true[[:space:]]*$' <<<"$PROXY_OUTPUT"; then
      return 0
    fi
    sleep 0.5
  done
  docker logs "$ENVOY_NAME" >&2 || true
  fail 'Envoy did not become ready on the internal network.'
}

wait_for_envoy

assert_local_error 'private IPv4 literal over allowed HTTP port 80' 'http://127.0.0.1:80/synthetic' 503
assert_local_error 'private Docker DNS alias over allowed HTTP port 80' 'http://private-canary:80/synthetic' 503
assert_local_error 'unsupported HTTP destination port 8081' 'http://private-canary:8081/synthetic' 403
assert_local_error 'private IPv4 literal over allowed HTTPS CONNECT port 443' 'https://127.0.0.1:443/synthetic' 503
assert_local_error 'unsupported HTTPS CONNECT port 444' 'https://127.0.0.1:444/synthetic' 403

canary_log="$(docker logs "$CANARY_NAME" 2>&1)"
if grep -q 'CANARY_REQUEST ' <<<"$canary_log"; then
  printf '%s\n' "$canary_log" >&2
  fail 'Private canary received a request; expected zero requests.'
fi
grep -q 'CANARY_READY' <<<"$canary_log" || fail 'Private canary did not report ready.'
printf 'PASS: private canary received zero requests\n'
printf 'PASS: synthetic Envoy smoke complete. No public targets contacted.\n'
printf 'LIMIT: this does not prove DNS rebinding resistance or host/cloud egress ACLs.\n'
