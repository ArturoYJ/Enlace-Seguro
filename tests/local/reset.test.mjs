import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const reset = resolve('scripts/local/reset');

function runReset(t, args, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'enlaceseguro-reset-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, 'docker.log');
  writeFileSync(join(dir, 'lsof'), '#!/bin/sh\n[ "${MOCK_API_RUNNING:-0}" = 1 ]\n', { mode: 0o755 });
  writeFileSync(join(dir, 'docker'), `#!/bin/sh
printf '%s\\n' "$*" >> "$MOCK_DOCKER_LOG"
case "$1 $2" in
  'volume inspect')
    [ "\${MOCK_VOLUME_EXISTS:-1}" = 1 ] || exit 1
    [ "\${4:-}" = '--format' ] && printf '%s\\n' "\${MOCK_LABEL:-enlaceseguro-local}"
    exit 0 ;;
  'compose -p')
    case "$*" in *'ps -aq mongo'*) printf '%s\\n' "\${MOCK_OWN_ID:-own}" ;; esac
    exit 0 ;;
  'ps -aq') printf '%s\\n' "\${MOCK_ATTACHED:-own}"; exit 0 ;;
esac
exit 1
`, { mode: 0o755 });
  const result = spawnSync(reset, args, {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${dir}:${process.env.PATH}`, MOCK_DOCKER_LOG: log,
      MOCK_API_RUNNING: '0', MOCK_VOLUME_EXISTS: '1', MOCK_LABEL: 'enlaceseguro-local',
      MOCK_OWN_ID: 'own', MOCK_ATTACHED: 'own', ...overrides,
    },
  });
  let calls = '';
  try { calls = readFileSync(log, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...result, calls };
}

test('reset refuses without explicit confirmation before invoking Docker', (t) => {
  const result = runReset(t, []);
  assert.equal(result.status, 2);
  assert.equal(result.calls, '');
});

test('reset refuses while an API listens on the local port', (t) => {
  const result = runReset(t, ['--confirm'], { MOCK_API_RUNNING: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Stop the local API/);
  assert.equal(result.calls, '');
});

test('reset refuses a volume with a different project label', (t) => {
  const result = runReset(t, ['--confirm'], { MOCK_LABEL: 'another-project' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /label mismatch/);
  assert.doesNotMatch(result.calls, /down --volumes/);
});

test('reset refuses a volume attached to another container', (t) => {
  const result = runReset(t, ['--confirm'], { MOCK_ATTACHED: 'own\nunrelated' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unrelated container/);
  assert.doesNotMatch(result.calls, /down --volumes/);
});

test('confirmed reset targets only the fixed project when safeguards pass', (t) => {
  const result = runReset(t, ['--confirm']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /compose -p enlaceseguro-local -f .*infra\/local\/docker-compose\.yml down --volumes/);
});

test('confirmed reset is safe to invoke when the volume is already absent', (t) => {
  const result = runReset(t, ['--confirm'], { MOCK_VOLUME_EXISTS: '0' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /compose -p enlaceseguro-local -f .*infra\/local\/docker-compose\.yml down --volumes/);
});
