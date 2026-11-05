#!/usr/bin/env bash
set -Eeuo pipefail

# Synthetic Docker topology test for Sandbox-side direct-egress isolation.
# This proves only Docker network attachment behavior on this local host.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CONFIG_FILE="$ROOT_DIR/sandbox/egress-proxy/envoy.yaml"
ENVOY_IMAGE="envoyproxy/envoy:v1.40.2"
CURL_IMAGE="curlimages/curl:8.12.1"
CANARY_IMAGE="node:22-alpine"
RUN_ID="$(date +%s)-$$-${RANDOM}"
RESOURCE_PREFIX="enlaceseguro-topology-${RUN_ID}"
SANDBOX_NETWORK="${RESOURCE_PREFIX}-sandbox"
PROXY_NETWORK="${RESOURCE_PREFIX}-proxy"
ENVOY_NAME="${RESOURCE_PREFIX}-envoy"
CANARY_NAME="${RESOURCE_PREFIX}-canary"
CLIENT_NAME="${RESOURCE_PREFIX}-client"
VALIDATOR_NAME="${RESOURCE_PREFIX}-validator"
CANARY_IP="198.18.0.10"
OWNED_CONTAINERS=("$VALIDATOR_NAME" "$ENVOY_NAME" "$CANARY_NAME" "$CLIENT_NAME")
CREATED_NETWORKS=()
ACTIVE_CLIENT_NAME=""

cleanup() {
  local name
  if [[ -n "$ACTIVE_CLIENT_NAME" ]]; then
    docker rm -f "$ACTIVE_CLIENT_NAME" >/dev/null 2>&1 || true
  fi
  for name in "${OWNED_CONTAINERS[@]}"; do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
  for name in "${CREATED_NETWORKS[@]}"; do
    docker network rm "$name" >/dev/null 2>&1 || true
  done
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

printf 'Validating Envoy config with pinned image %s\n' "$ENVOY_IMAGE"
docker run --rm \
  --name "$VALIDATOR_NAME" \
  -v "$CONFIG_FILE:/etc/envoy/envoy.yaml:ro" \
  "$ENVOY_IMAGE" --mode validate -c /etc/envoy/envoy.yaml

printf 'Creating two private Docker networks; no ports are published.\n'
docker network create --internal \
  --label "enlaceseguro.topology.run=${RUN_ID}" \
  --subnet 192.0.2.0/24 "$SANDBOX_NETWORK" >/dev/null
CREATED_NETWORKS+=("$SANDBOX_NETWORK")
docker network create --internal \
  --label "enlaceseguro.topology.run=${RUN_ID}" \
  --subnet 198.18.0.0/24 "$PROXY_NETWORK" >/dev/null
CREATED_NETWORKS+=("$PROXY_NETWORK")

[[ "$(docker network inspect --format '{{.Internal}}' "$SANDBOX_NETWORK")" == true ]] || fail 'Sandbox-side network is not internal.'
[[ "$(docker network inspect --format '{{.Internal}}' "$PROXY_NETWORK")" == true ]] || fail 'Proxy-side network is not internal.'

printf 'Starting synthetic canary only on proxy-side network %s\n' "$PROXY_NETWORK"
docker run -d --rm \
  --name "$CANARY_NAME" \
  --network "$PROXY_NETWORK" \
  --ip "$CANARY_IP" \
  --network-alias private-canary \
  "$CANARY_IMAGE" \
  node -e 'require("node:http").createServer((req,res)=>{console.log("CANARY_REQUEST "+req.url);res.writeHead(200,{"content-type":"text/plain"});res.end("synthetic-canary")}).listen(80,"0.0.0.0",()=>console.log("CANARY_READY"))' >/dev/null

printf 'Starting Envoy on Sandbox-side network, then attaching proxy-side network.\n'
docker run -d --rm \
  --name "$ENVOY_NAME" \
  --network "$SANDBOX_NETWORK" \
  --network-alias egress-proxy \
  -v "$CONFIG_FILE:/etc/envoy/envoy.yaml:ro" \
  "$ENVOY_IMAGE" -c /etc/envoy/envoy.yaml >/dev/null
docker network connect "$PROXY_NETWORK" "$ENVOY_NAME"

printf 'Starting untrusted client only on Sandbox-side network %s\n' "$SANDBOX_NETWORK"
docker run -d --rm \
  --name "$CLIENT_NAME" \
  --network "$SANDBOX_NETWORK" \
  "$CURL_IMAGE" sleep 120 >/dev/null

client_networks="$(docker inspect --format '{{range $name, $network := .NetworkSettings.Networks}}{{$name}} {{end}}' "$CLIENT_NAME")"
canary_networks="$(docker inspect --format '{{range $name, $network := .NetworkSettings.Networks}}{{$name}} {{end}}' "$CANARY_NAME")"
envoy_networks="$(docker inspect --format '{{range $name, $network := .NetworkSettings.Networks}}{{$name}} {{end}}' "$ENVOY_NAME")"
[[ "$client_networks" == "$SANDBOX_NETWORK " ]] || fail "Client has unexpected network attachments: $client_networks"
[[ "$canary_networks" == "$PROXY_NETWORK " ]] || fail "Canary has unexpected network attachments: $canary_networks"
[[ "$envoy_networks" == *"$SANDBOX_NETWORK"* && "$envoy_networks" == *"$PROXY_NETWORK"* ]] || fail "Envoy is not dual-homed: $envoy_networks"
[[ "$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CANARY_NAME")" == "$CANARY_IP" ]] || fail 'Canary does not have the expected synthetic IP.'

direct_output=""
set +e
direct_output="$(docker exec "$CLIENT_NAME" curl \
  --noproxy '*' --silent --show-error --max-time 3 \
  "http://${CANARY_IP}:80/direct-egress" 2>&1)"
direct_exit_code=$?
set -e
if [[ "$direct_exit_code" == 0 ]]; then
  printf '%s\n' "$direct_output" >&2
  fail 'Direct client-to-canary request succeeded; expected network isolation.'
fi
printf 'PASS: direct Sandbox-side client to canary IP failed (curl exit %s)\n' "$direct_exit_code"

proxy_output=""
set +e
proxy_output="$(docker exec "$CLIENT_NAME" curl \
  --noproxy '' --silent --show-error --max-time 8 \
  --proxy http://egress-proxy:10000 \
  --dump-header - --output /dev/null \
  http://private-canary:80/proxy-denied 2>&1)"
proxy_exit_code=$?
set -e
if [[ "$proxy_exit_code" != 0 ]]; then
  printf '%s\n' "$proxy_output" >&2
  fail "Client could not complete the request through Envoy (curl exit $proxy_exit_code)."
fi
if ! grep -Eiq '^HTTP/[0-9.]+ 503([[:space:]]|$)' <<<"$proxy_output"; then
  printf '%s\n' "$proxy_output" >&2
  fail 'Envoy did not return HTTP 503 for the private synthetic canary.'
fi
if ! grep -Eiq '^x-enlaceseguro-egress-error:[[:space:]]*true[[:space:]]*$' <<<"$proxy_output"; then
  printf '%s\n' "$proxy_output" >&2
  fail 'Envoy response did not include its local-egress-error marker.'
fi
printf 'PASS: client reached Envoy; private target denied with HTTP 503 and local-error marker\n'

canary_log="$(docker logs "$CANARY_NAME" 2>&1)"
if grep -q 'CANARY_REQUEST ' <<<"$canary_log"; then
  printf '%s\n' "$canary_log" >&2
  fail 'Synthetic canary received a request; expected zero requests.'
fi
grep -q 'CANARY_READY' <<<"$canary_log" || fail 'Synthetic canary did not report ready.'
printf 'PASS: synthetic canary received zero requests\n'
printf 'PASS: topology boundary test complete; no public destinations contacted.\n'
printf 'LIMIT: this proves only local Docker network attachment behavior, not host/cloud ACLs or DNS rebinding resistance.\n'
