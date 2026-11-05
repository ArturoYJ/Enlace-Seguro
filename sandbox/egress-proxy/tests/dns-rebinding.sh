#!/usr/bin/env bash
set -Eeuo pipefail

# Deterministic DNS TOCTOU test. All answers and destinations are synthetic;
# no public DNS or target is contacted. Envoy uses a dedicated DNS fixture.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CONFIG_FILE="$ROOT_DIR/sandbox/egress-proxy/envoy.yaml"
CONFIG_RENDERER="$ROOT_DIR/sandbox/egress-proxy/tests/render-dns-test-config.mjs"
DNS_FIXTURE="$ROOT_DIR/sandbox/egress-proxy/tests/dns-fixture.mjs"
ENVOY_IMAGE="envoyproxy/envoy:v1.40.2"
NODE_IMAGE="node:22-alpine"
RUN_ID="$(date +%s)-$$-${RANDOM}"
RESOURCE_PREFIX="enlaceseguro-dns-rebind-${RUN_ID}"
NETWORK_NAME="${RESOURCE_PREFIX}-internal"
HOSTLINK_NETWORK="${RESOURCE_PREFIX}-hostlink"
ENVOY_NAME="${RESOURCE_PREFIX}-envoy"
DNS_NAME="${RESOURCE_PREFIX}-dns"
CANARY_NAME="${RESOURCE_PREFIX}-canary"
DNS_IP="198.18.0.53"
CANARY_IP="198.18.0.10"
TARGET_HOST="rebind-${RUN_ID}.fixture.example"
TEMP_CONFIG_FILE=""
NETWORK_CREATED=0
HOSTLINK_CREATED=0
DNS_DROP_AFTER_A_QUERIES="${DNS_DROP_AFTER_A_QUERIES:-}"

cleanup() {
  docker rm -f "$ENVOY_NAME" "$DNS_NAME" "$CANARY_NAME" >/dev/null 2>&1 || true
  if [[ "$NETWORK_CREATED" == 1 ]]; then docker network rm "$NETWORK_NAME" >/dev/null 2>&1 || true; fi
  if [[ "$HOSTLINK_CREATED" == 1 ]]; then docker network rm "$HOSTLINK_NETWORK" >/dev/null 2>&1 || true; fi
  if [[ -n "$TEMP_CONFIG_FILE" ]]; then rm -f "$TEMP_CONFIG_FILE"; fi
}
trap cleanup EXIT INT TERM

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

for command in docker node npm; do command -v "$command" >/dev/null 2>&1 || fail "Required command not found: $command"; done
for file in "$CONFIG_FILE" "$CONFIG_RENDERER" "$DNS_FIXTURE"; do [[ -f "$file" ]] || fail "Required file not found: $file"; done

TEMP_CONFIG_FILE="$(mktemp "${TMPDIR:-/tmp}/es-envoy-dns-${RUN_ID}.XXXXXX.yaml")"
node "$CONFIG_RENDERER" "$CONFIG_FILE" "$TEMP_CONFIG_FILE" "$DNS_IP"
docker run --rm -v "$TEMP_CONFIG_FILE:/etc/envoy/envoy.yaml:ro" "$ENVOY_IMAGE" --mode validate -c /etc/envoy/envoy.yaml

docker network create --internal --subnet 198.18.0.0/24 --label "enlaceseguro.dns-rebind.run=${RUN_ID}" "$NETWORK_NAME" >/dev/null
NETWORK_CREATED=1
docker network create --label "enlaceseguro.dns-rebind.run=${RUN_ID}" "$HOSTLINK_NETWORK" >/dev/null
HOSTLINK_CREATED=1

docker run -d --rm --name "$CANARY_NAME" --network "$NETWORK_NAME" --ip "$CANARY_IP" \
  "$NODE_IMAGE" node -e 'require("node:http").createServer((req,res)=>{console.log("PRIVATE_CANARY_REQUEST "+req.url);res.writeHead(200,{"content-type":"text/plain"});res.end("must not be reached")}).listen(80,"0.0.0.0",()=>console.log("PRIVATE_CANARY_READY"))' >/dev/null

DNS_ENV=(-e "REBIND_HOST=$TARGET_HOST")
if [[ -n "$DNS_DROP_AFTER_A_QUERIES" ]]; then DNS_ENV+=(-e "DNS_DROP_AFTER_A_QUERIES=$DNS_DROP_AFTER_A_QUERIES"); fi
docker run -d --rm --name "$DNS_NAME" --network "$HOSTLINK_NETWORK" -p 127.0.0.1::53/udp \
  "${DNS_ENV[@]}" -v "$DNS_FIXTURE:/opt/dns-fixture.mjs:ro" "$NODE_IMAGE" node /opt/dns-fixture.mjs >/dev/null
docker network connect --ip "$DNS_IP" "$NETWORK_NAME" "$DNS_NAME"

docker run -d --rm --name "$ENVOY_NAME" --network "$HOSTLINK_NETWORK" -p 127.0.0.1::10000 \
  -v "$TEMP_CONFIG_FILE:/etc/envoy/envoy.yaml:ro" "$ENVOY_IMAGE" -c /etc/envoy/envoy.yaml >/dev/null
docker network connect "$NETWORK_NAME" "$ENVOY_NAME"

DNS_HOST_PORT="$(docker port "$DNS_NAME" 53/udp | awk -F: '/127\.0\.0\.1:/ {print $NF; exit}')"
PROXY_HOST_PORT="$(docker port "$ENVOY_NAME" 10000/tcp | awk -F: '/127\.0\.0\.1:/ {print $NF; exit}')"
[[ "$DNS_HOST_PORT" =~ ^[0-9]+$ ]] || fail 'Docker did not assign a loopback DNS fixture port.'
[[ "$PROXY_HOST_PORT" =~ ^[0-9]+$ ]] || fail 'Docker did not assign a loopback Envoy port.'

export ENVOY_DNS_REBINDING_TEST=1
export ENVOY_DNS_REBINDING_HOST="$TARGET_HOST"
export ENVOY_DNS_FIXTURE_HOST_PORT="$DNS_HOST_PORT"
export SANDBOX_EGRESS_PROXY_URL="http://127.0.0.1:${PROXY_HOST_PORT}"

printf 'Testing split DNS for synthetic hostname %s\n' "$TARGET_HOST"
cd "$ROOT_DIR/sandbox"
node --test --test-concurrency=1 --import tsx browser-tests/egress-proxy-dns-rebinding.integration.browser.ts

dns_log="$(docker logs "$DNS_NAME" 2>&1)"
expected_dns_entries=(
  "DNS_A_QUERY number=1 name=$TARGET_HOST address=192.0.2.10"
  "DNS_A_QUERY number=2 name=$TARGET_HOST address=192.0.2.10"
)
if [[ "$DNS_DROP_AFTER_A_QUERIES" == 2 ]]; then
  expected_dns_entries+=("DNS_A_QUERY_DROPPED number=3 name=$TARGET_HOST")
else
  expected_dns_entries+=("DNS_A_QUERY number=3 name=$TARGET_HOST address=$CANARY_IP")
fi
for expected in "${expected_dns_entries[@]}"; do
  grep -Fq "$expected" <<<"$dns_log" || { printf '%s\n' "$dns_log" >&2; fail "Missing expected DNS sequence entry: $expected"; }
done
if grep -q 'PRIVATE_CANARY_REQUEST ' <<<"$(docker logs "$CANARY_NAME" 2>&1)"; then
  docker logs "$CANARY_NAME" >&2
  fail 'Private canary received a request.'
fi
if [[ "$DNS_DROP_AFTER_A_QUERIES" == 2 ]]; then
  printf 'PASS: DNS answered preflight twice, then stopped responding; Envoy failed closed\n'
else
  printf 'PASS: DNS answered synthetic preflight twice, then private canary IP; Envoy denied it\n'
fi
printf 'PASS: no capture and zero private-canary requests\n'
printf 'LIMIT: local synthetic DNS/proxy evidence; not cloud ACL or production approval\n'
