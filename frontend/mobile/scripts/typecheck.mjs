import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const generatedTypes = path.join(root, '.expo', 'types', 'router.d.ts');
const expectedRoutes = ['/history', '/account', '/analysis/[attemptId]'];
const cli = path.join(root, 'node_modules', 'expo', 'bin', 'cli');

await mkdir(path.dirname(generatedTypes), { recursive: true });
await rm(generatedTypes, { force: true });

const server = spawn(process.execPath, [cli, 'start', '--offline', '--port', '8097'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CI: '1' },
});

let serverOutput = '';
server.stdout.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk; });
server.stderr.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk; });

try {
  const startedAt = Date.now();
  let routeTypesReady = false;
  while (Date.now() - startedAt < 45000) {
    if (server.exitCode !== null) throw new Error(`Expo exited before generating route types (code ${server.exitCode}).`);
    try {
      const contents = await readFile(generatedTypes, 'utf8');
      routeTypesReady = expectedRoutes.every((route) => contents.includes(`\`${route}\``));
      if (routeTypesReady) break;
    } catch { /* Expo has not emitted the file yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!routeTypesReady) throw new Error('Expo did not generate the typed route declaration in time.');
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3000);
      server.once('exit', () => { clearTimeout(timeout); resolve(); });
    });
  }
}

if (server.exitCode !== null && server.exitCode !== 0) {
  throw new Error(`Expo type generation failed.\n${serverOutput.slice(-5000)}`);
}

const tsc = spawn(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'], {
  cwd: root,
  stdio: 'inherit',
});
const exitCode = await new Promise((resolve) => tsc.once('exit', (code) => resolve(code ?? 1)));
process.exitCode = Number(exitCode);
