#!/usr/bin/env bash
set -Eeuo pipefail

# Uses only a loopback HTTP fixture and an intentionally unused loopback proxy port.
# No Docker, public DNS, or public destinations are used.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
command -v node >/dev/null 2>&1 || { printf 'FAIL: Required command not found: node\n' >&2; exit 1; }
cd "$ROOT_DIR/sandbox"
SANDBOX_PROXY_OUTAGE_TEST=1 \
  node --test --test-concurrency=1 --import tsx browser-tests/egress-proxy-outage.integration.browser.ts
