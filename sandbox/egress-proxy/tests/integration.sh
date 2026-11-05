#!/usr/bin/env bash
set -Eeuo pipefail

# Synthetic-only Chromium + Envoy test. The proxy is published on loopback only.
# It proves the browser path uses Envoy and that a private DNS result is denied;
# it does not prove host/cloud ACLs or a production DNS resolver policy.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CONFIG_FILE="$ROOT_DIR/sandbox/egress-proxy/envoy.yaml"
ENVOY_IMAGE="envoyproxy/envoy:v1.40.2"
CANARY_IMAGE="node:22-alpine"
RUN_ID="$(date +%s)-$$-${RANDOM}"
RESOURCE_PREFIX="enlaceseguro-envoy-integration-${RUN_ID}"
NETWORK_NAME="${RESOURCE_PREFIX}-internal"
HOSTLINK_NETWORK="${RESOURCE_PREFIX}-hostlink"
ENVOY_NAME="${RESOURCE_PREFIX}-envoy"
CANARY_NAME="${RESOURCE_PREFIX}-canary"
NETWORK_CREATED=0
HOSTLINK_CREATED=0

cleanup() {
  docker rm -f "$ENVOY_NAME" "$CANARY_NAME" >/dev/null 2>&1 || true
  if [[ "$NETWORK_CREATED" == 1 ]]; then
    docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
  fi
  if [[ "$HOSTLINK_CREATED" == 1 ]]; then
    docker network rm "$HOSTLINK_NETWORK" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail 'Required command not found: docker'
command -v npm >/dev/null 2>&1 || fail 'Required command not found: npm'
[[ -f "$CONFIG_FILE" ]] || fail "Envoy config not found: $CONFIG_FILE"

docker run --rm \
  -v "$CONFIG_FILE:/etc/envoy/envoy.yaml:ro" \
  "$ENVOY_IMAGE" --mode validate -c /etc/envoy/envoy.yaml

docker network create --internal --label "enlaceseguro.integration.run=${RUN_ID}" "$NETWORK_NAME" >/dev/null
NETWORK_CREATED=1
[[ "$(docker network inspect --format '{{.Internal}}' "$NETWORK_NAME")" == true ]] || fail 'Docker network is not internal.'
docker network create --label "enlaceseguro.integration.run=${RUN_ID}" "$HOSTLINK_NETWORK" >/dev/null
HOSTLINK_CREATED=1

docker run -d --rm \
  --name "$CANARY_NAME" \
  --network "$NETWORK_NAME" \
  --network-alias private-canary \
  "$CANARY_IMAGE" \
  node -e 'require("node:http").createServer((req,res)=>{console.log("PRIVATE_CANARY_REQUEST "+req.url);res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end("<!doctype html><html><body>must not be reached</body></html>")}).listen(80,"0.0.0.0",()=>console.log("PRIVATE_CANARY_READY"))' >/dev/null

# The proxy gets a test-only bridge for loopback port publishing plus the isolated
# private target network. Chromium runs on the host; no public listener or target.
docker run -d --rm \
  --name "$ENVOY_NAME" \
  --network "$HOSTLINK_NETWORK" \
  -p 127.0.0.1::10000 \
  -v "$CONFIG_FILE:/etc/envoy/envoy.yaml:ro" \
  "$ENVOY_IMAGE" -c /etc/envoy/envoy.yaml >/dev/null
docker network connect --alias egress-proxy "$NETWORK_NAME" "$ENVOY_NAME"

PROXY_PORT="$(docker port "$ENVOY_NAME" 10000/tcp | awk -F: '/127\.0\.0\.1:/ {print $NF; exit}')"
[[ "$PROXY_PORT" =~ ^[0-9]+$ ]] || fail 'Docker did not assign a loopback proxy port.'
export SANDBOX_EGRESS_PROXY_URL="http://127.0.0.1:${PROXY_PORT}"
export ENVOY_INTEGRATION_TEST=1
export ENVOY_INTEGRATION_TARGET_URL='http://private-canary/synthetic'

printf 'Running real Chromium through Envoy at %s to a private synthetic DNS alias\n' "$SANDBOX_EGRESS_PROXY_URL"
cd "$ROOT_DIR/sandbox"
node --test --test-concurrency=1 --import tsx browser-tests/egress-proxy-envoy.integration.browser.ts

canary_log="$(docker logs "$CANARY_NAME" 2>&1)"
if grep -q 'PRIVATE_CANARY_REQUEST ' <<<"$canary_log"; then
  printf '%s\n' "$canary_log" >&2
  fail 'Private canary received a request; expected zero requests.'
fi
grep -q 'PRIVATE_CANARY_READY' <<<"$canary_log" || fail 'Private canary did not report ready.'
printf 'PASS: private canary received zero requests\n'
printf 'PASS: Chromium received Envoy denial marker; Sandbox produced no capture\n'
printf 'LIMIT: synthetic Docker evidence only; no production ACL or DNS infrastructure proved\n'
