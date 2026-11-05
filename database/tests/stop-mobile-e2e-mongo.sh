#!/usr/bin/env bash
set -euo pipefail

container_name="${MOBILE_E2E_MONGO_CONTAINER:-}"
if [[ -z "$container_name" ]]; then exit 0; fi
if [[ ! "$container_name" =~ ^enlaceseguro-mobile-e2e-[a-z0-9_-]+$ ]]; then
  echo "Refusing to stop unexpected container name '$container_name'." >&2
  exit 2
fi
if command -v docker >/dev/null 2>&1 && docker inspect "$container_name" >/dev/null 2>&1; then
  docker rm -f "$container_name" >/dev/null
fi
