#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SANDBOX_DIR="$ROOT_DIR/sandbox"
SECCOMP_PROFILE="$SANDBOX_DIR/seccomp_profile.json"
PLAYWRIGHT_PROFILE_VERSION="1.64.1"
EXPECTED_SECCOMP_SHA256="cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849"
IMAGE_TAG="${SANDBOX_HARDENING_IMAGE_TAG:-enlaceseguro-sandbox:security-smoke}"
CONTAINER_NAME="enlaceseguro-sandbox-security-smoke-$(date +%s)-$$-${RANDOM}"
CONTAINER_CREATED=0

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ "$CONTAINER_CREATED" == 1 ]]; then
    docker stop --time 5 "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker container rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

command -v docker >/dev/null 2>&1 || fail 'Docker CLI is required.'
[[ -f "$SECCOMP_PROFILE" ]] || fail 'Pinned Playwright seccomp profile is missing.'
locked_playwright_version="$(node -p "require('$SANDBOX_DIR/package-lock.json').packages['node_modules/playwright'].version")"
[[ "$locked_playwright_version" == "$PLAYWRIGHT_PROFILE_VERSION" ]] || fail "Playwright lockfile changed to $locked_playwright_version; review and pin a matching seccomp profile."
actual_sha256="$(shasum -a 256 "$SECCOMP_PROFILE" | awk '{print $1}')"
[[ "$actual_sha256" == "$EXPECTED_SECCOMP_SHA256" ]] || fail 'Seccomp profile changed; review it against the pinned Playwright release before updating the expected digest.'
python3 -m json.tool "$SECCOMP_PROFILE" >/dev/null || fail 'Seccomp profile is not valid JSON.'

printf 'Building hardened Sandbox image %s\n' "$IMAGE_TAG"
docker build --tag "$IMAGE_TAG" "$SANDBOX_DIR"

printf 'Starting with network disabled, read-only root, dropped capabilities and pinned seccomp.\n'
docker run --detach \
  --name "$CONTAINER_NAME" \
  --network none \
  --read-only \
  --cap-drop=ALL \
  --cap-add=SYS_CHROOT \
  --security-opt=no-new-privileges \
  --security-opt="seccomp=$SECCOMP_PROFILE" \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --tmpfs /run:rw,noexec,nosuid,size=16m \
  --tmpfs /app/captures:rw,noexec,nosuid,size=16m \
  --env SANDBOX_SERVICE_TOKEN=synthetic-test-token-12345678901234567890 \
  --env SANDBOX_EGRESS_PROXY_URL=http://127.0.0.1:10000 \
  "$IMAGE_TAG" >/dev/null
CONTAINER_CREATED=1

state=''
for _ in $(seq 1 30); do
  state="$(docker inspect --format '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  [[ "$state" == running ]] || break
  if docker exec "$CONTAINER_NAME" node -e '
    fetch("http://127.0.0.1:3001/health")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || body.status !== "healthy") process.exit(1);
      })
      .catch(() => process.exit(1));
  ' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

[[ "$state" == running ]] || {
  docker logs "$CONTAINER_NAME" 2>&1 | tail -60 || true
  fail "Hardened container exited before health check (state=${state:-missing})."
}
docker exec "$CONTAINER_NAME" unshare --user --map-root-user /bin/true >/dev/null || fail 'User namespaces are unavailable with the selected seccomp/runtime.'
[[ "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$CONTAINER_NAME")" == true ]] || fail 'Container root filesystem is not read-only.'
[[ "$(docker inspect --format '{{json .HostConfig.CapDrop}}' "$CONTAINER_NAME")" == '["ALL"]' ]] || fail 'Container did not drop all default capabilities.'
[[ "$(docker inspect --format '{{json .HostConfig.CapAdd}}' "$CONTAINER_NAME")" == '["CAP_SYS_CHROOT"]' ]] || fail 'Container must add only SYS_CHROOT for Chromium user-namespace sandboxing.'
[[ "$(docker inspect --format '{{json .HostConfig.SecurityOpt}}' "$CONTAINER_NAME")" == *no-new-privileges* ]] || fail 'no-new-privileges is not enabled.'

printf 'PASS: Chromium starts sandboxed as non-root under the pinned seccomp profile.\n'
printf 'PASS: read-only root, no network, no-new-privileges, all default caps dropped; SYS_CHROOT is the sole added capability.\n'
printf 'LIMIT: this is a local container smoke test, not proof of cloud ACLs, production egress, storage persistence or provider runtime behavior.\n'
