import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const reset = resolve('scripts/local/reset');

test('reset and migrate fail closed when lsof cannot execute', () => {
  for (const script of ['scripts/local/reset', 'scripts/local/migrate']) {
    const result = spawnSync('bash', ['-c', `lsof(){ return 127; }; docker(){ echo DOCKER_CALLED >&2; return 1; }; export -f lsof docker; bash "$1" "${script.endsWith('reset') ? '--confirm' : ''}"`, 'test', resolve(script)], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, script);
    assert.doesNotMatch(result.stderr, /DOCKER_CALLED/, script);
  }
});

test('port checks block an active API and permit the no-listener branch', () => {
  for (const script of ['scripts/local/reset', 'scripts/local/migrate']) {
    for (const code of [0, 1]) {
      const result = spawnSync('bash', ['-c', `lsof(){ return ${code}; }; docker(){ echo DOCKER_CALLED >&2; return 1; }; export -f lsof docker; bash "$1" "${script.endsWith('reset') ? '--confirm' : ''}"`, 'test', resolve(script)], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, script);
      if (code === 0) assert.doesNotMatch(result.stderr, /DOCKER_CALLED/, script);
      else assert.match(result.stderr, /DOCKER_CALLED/, script);
    }
  }
});

test('reset and migrate reject lsof errors even when it returns one', () => {
  for (const script of ['scripts/local/reset', 'scripts/local/migrate']) {
    const result = spawnSync('bash', ['-c', `lsof(){ echo 'simulated failure' >&2; return 1; }; docker(){ echo DOCKER_CALLED >&2; return 1; }; export -f lsof docker; bash "$1" "${script.endsWith('reset') ? '--confirm' : ''}"`, 'test', resolve(script)], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, script);
    assert.doesNotMatch(result.stderr, /DOCKER_CALLED/, script);
  }
});

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
