#!/usr/bin/env node
// Opt-in local lifecycle harness. All services bind/publish on loopback; no volume or public URL is used.
// Usage: cd api && npm run build && node tests/operations/worker-shutdown-recovery.mjs
// Prerequisites: Node 22, API dependencies installed, Docker running, and image mongo:8.0.34 already present.

import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const execFileAsync = promisify(execFile);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(apiRoot, '..');
const apiEntry = path.join(apiRoot, 'dist/index.js');
const migrationNames = [
  '001_create_mongodb_schema.js',
  '002_create_login_rate_limit_buckets.js',
  '003_encrypt_analysis_inputs.js',
  '004_durable_analysis_jobs.js',
  '005_analysis_queue_capacity.js',
  '006_extend_analysis_history_retention_366_days.js'
];
const queueMaxPending = 20;
const sandboxTimeoutMs = 1_000;
const shutdownGraceMs = 6_000;
const leaseDurationMs = 12_000;
const workerPollMs = 100;
const serviceToken = randomBytes(32).toString('base64url');
const encryptionKey = randomBytes(32).toString('base64url');
const jwtSecret = randomBytes(48).toString('base64url');
const hmacKey = randomBytes(48).toString('base64url');
const databaseName = `enlaceseguro_test_worker_${process.pid}_${randomBytes(4).toString('hex')}`;
const containerName = `es-worker-recovery-${process.pid}-${randomBytes(3).toString('hex')}`;
const dockerImage = 'mongo:8.0.34';

let tempDirectory;
let mongoContainerStarted = false;
let mongoPort;
let mongoUri;
let mongoClient;
let fakeSandbox;
let fakeSandboxPort;
let api1Port;
let api2Port;
let api1;
let api2;
let cleanupPromise;
const apiChildren = new Set();
const requestCalls = [];
const nextApiGates = new Map();

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reserveLoopbackPort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function runCommand(file, args, options = {}) {
  try {
    return await execFileAsync(file, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout ?? 30_000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8'
    });
  } catch (error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const stdout = typeof error.stdout === 'string' ? error.stdout.trim() : '';
    throw new Error(`${file} ${args.join(' ')} failed${error.code ? ` (${error.code})` : ''}${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`);
  }
}

async function docker(args, options = {}) {
  return runCommand('docker', args, options);
}

async function waitFor(description, predicate, timeoutMs = 15_000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let timeoutHandle;
  const timedOut = Symbol('timed-out');
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve(timedOut), timeoutMs);
  });
  while (Date.now() < deadline) {
    try {
      const value = await Promise.race([Promise.resolve().then(predicate), timeoutPromise]);
      if (value === timedOut) break;
      if (value) {
        clearTimeout(timeoutHandle);
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  clearTimeout(timeoutHandle);
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

async function waitForPromise(description, promise, timeoutMs = 15_000) {
  let timeoutHandle;
  const timedOut = Symbol('timed-out');
  const result = await Promise.race([
    promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error })),
    new Promise((resolve) => { timeoutHandle = setTimeout(() => resolve(timedOut), timeoutMs); })
  ]);
  clearTimeout(timeoutHandle);
  if (result === timedOut) throw new Error(`Timed out waiting for ${description}.`);
  if (!result.ok) throw result.error;
  return result.value;
}

function processIsRunning(handle) {
  return handle && handle.child.exitCode === null && handle.child.signalCode === null;
}

function processLog(handle) {
  return handle?.logText ?? '';
}

async function startApi(label, port) {
  const sandboxBase = `http://127.0.0.1:${fakeSandboxPort}/${label}`;
  const childEnv = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? tmpdir(),
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    NODE_ENV: 'development',
    DOTENV_CONFIG_PATH: path.join(tempDirectory, 'empty.env'),
    HOST: '127.0.0.1',
    PORT: String(port),
    MONGODB_URI: mongoUri,
    MONGODB_DB_NAME: databaseName,
    SANDBOX_SERVICE_URL: sandboxBase,
    SANDBOX_SERVICE_TOKEN: serviceToken,
    SANDBOX_ANALYSIS_TIMEOUT_MS: String(sandboxTimeoutMs),
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN_SECONDS: '900',
    LOGIN_RATE_LIMIT_HMAC_KEY: hmacKey,
    ANALYSIS_INPUT_ENCRYPTION_KEY: encryptionKey,
    ANALYSIS_JOB_MAX_PENDING: String(queueMaxPending),
    ANALYSIS_JOB_CONCURRENCY: '1',
    ANALYSIS_JOB_POLL_INTERVAL_MS: String(workerPollMs),
    ANALYSIS_JOB_MAX_ATTEMPTS: '3',
    ANALYSIS_JOB_LEASE_MS: String(leaseDurationMs),
    ANALYSIS_JOB_SHUTDOWN_GRACE_MS: String(shutdownGraceMs),
    LOG_LEVEL: 'silent',
    CAPTURE_PROXY_ENABLED: 'false'
  };
  const child = spawn(process.execPath, [apiEntry], {
    cwd: apiRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const handle = { child, label, logText: '', exit: undefined };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { handle.logText += chunk; });
  child.stderr.on('data', (chunk) => { handle.logText += chunk; });
  handle.exit = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  apiChildren.add(handle);
  await waitFor(`${label} API readiness`, () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${label} exited before ready${handle.logText ? `: ${handle.logText.slice(-1_500)}` : ''}`);
    }
    return handle.logText.includes('[READY] EnlaceSeguro REST API listening');
  }, 20_000);
  return handle;
}

async function stopChild(handle, signal = 'SIGTERM', timeoutMs = 3_000) {
  if (!handle || !processIsRunning(handle)) return handle?.exit;
  handle.child.kill(signal);
  const result = await Promise.race([handle.exit, delay(timeoutMs).then(() => null)]);
  if (result) return result;
  if (processIsRunning(handle)) handle.child.kill('SIGKILL');
  return handle.exit;
}

function createSandboxResponse(attemptId, targetUrl) {
  return {
    attemptId,
    targetUrl,
    finalDestination: targetUrl,
    redirects: [],
    signals: [],
    sourceResults: [],
    outcome: 'completed',
    verdict: 'sin_amenazas_detectadas',
    reasons: []
  };
}

async function readRequestBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 80 * 1024) throw new Error('Harness fake Sandbox request exceeded its local test bound.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function startFakeSandbox() {
  fakeSandbox = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const apiLabel = url.pathname.split('/').filter(Boolean)[0];
      if (request.method !== 'POST' || !['api1', 'api2'].includes(apiLabel) || url.pathname !== `/${apiLabel}/analyze`) {
        response.writeHead(404).end();
        return;
      }
      if (request.headers.authorization !== `Bearer ${serviceToken}`) {
        response.writeHead(401).end();
        return;
      }
      const body = await readRequestBody(request);
      if (!body || typeof body.attemptId !== 'string' || typeof body.url !== 'string') {
        response.writeHead(400).end();
        return;
      }
      const target = new URL(body.url);
      if (target.protocol !== 'https:' || !target.hostname.endsWith('.test')) {
        throw new Error('Harness permits only synthetic HTTPS *.test targets.');
      }

      const call = { apiLabel, attemptId: body.attemptId, targetUrl: body.url, at: Date.now() };
      requestCalls.push(call);

      const gate = nextApiGates.get(apiLabel);
      if (gate) {
        nextApiGates.delete(apiLabel);
        gate.received.resolve(call);
      }
      if (gate) {
        const closed = deferred();
        response.once('close', () => closed.resolve('closed'));
        const outcome = await Promise.race([gate.release.promise.then(() => 'released'), closed.promise]);
        if (outcome !== 'released' || response.destroyed) return;
      }

      const payload = JSON.stringify(createSandboxResponse(body.attemptId, body.url));
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
      response.end(payload);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) response.writeHead(400).end();
      if (error instanceof Error && !error.message.includes('Harness')) {
        console.error(`Fake Sandbox request rejected: ${error.message}`);
      }
    }
  });
  await new Promise((resolve, reject) => {
    fakeSandbox.once('error', reject);
    fakeSandbox.listen(0, '127.0.0.1', resolve);
  });
  const address = fakeSandbox.address();
  assert.ok(address && typeof address === 'object');
  fakeSandboxPort = address.port;
}

function holdNextApiRequest(apiLabel) {
  assert.ok(['api1', 'api2'].includes(apiLabel));
  assert.equal(nextApiGates.has(apiLabel), false, `only one ${apiLabel} fake Sandbox gate may be pending`);
  const gate = { received: deferred(), release: deferred() };
  nextApiGates.set(apiLabel, gate);
  return gate;
}

async function httpJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    redirect: 'error'
  });
  const responseText = await response.text();
  let body;
  try { body = responseText ? JSON.parse(responseText) : undefined; }
  catch { throw new Error(`API returned a non-JSON response (HTTP ${response.status}).`); }
  return { status: response.status, body };
}

async function registerAndLogin(apiBase) {
  const email = `worker-${randomUUID().slice(0, 8)}@example.test`;
  const password = `synthetic-${randomBytes(16).toString('hex')}-Pass!`;
  const register = await httpJson(apiBase, '/api/v1/auth/register', {
    method: 'POST', body: { email, password }
  });
  assert.equal(register.status, 201, 'synthetic user registration succeeds');
  const login = await httpJson(apiBase, '/api/v1/auth/login', {
    method: 'POST', body: { email, password }
  });
  assert.equal(login.status, 200, 'synthetic user login succeeds');
  assert.equal(typeof login.body?.accessToken, 'string');
  return login.body.accessToken;
}

async function submitAnalysis(apiBase, accessToken, suffix) {
  const targetUrl = `https://worker-${suffix}.test/synthetic-path`;
  const accepted = await httpJson(apiBase, '/api/v1/analyses', {
    method: 'POST', token: accessToken, body: { input: targetUrl }
  });
  assert.equal(accepted.status, 201, 'analysis admission succeeds');
  assert.equal(accepted.body?.processingStatus, 'received');
  assert.match(accepted.body?.attemptId ?? '', /^[0-9a-f-]{36}$/i);
  return { attemptId: accepted.body.attemptId, localDate: accepted.body.localDate, targetUrl };
}

async function getAttemptState(attemptId) {
  const document = await mongoClient.db(databaseName).collection('daily_analyses')
    .findOne({ 'attempts.attemptId': attemptId });
  const attempt = document?.attempts?.find((candidate) => candidate.attemptId === attemptId);
  assert.ok(attempt, 'attempt exists in disposable MongoDB');
  return { document, attempt };
}

async function getDetail(apiBase, token, attempt) {
  return httpJson(apiBase, `/api/v1/analyses/${attempt.attemptId}?localDate=${encodeURIComponent(attempt.localDate)}`, { token });
}

async function applyMigrations() {
  const names = await docker(['exec', containerName, 'mongosh', mongoUri, '--quiet', '--eval', 'JSON.stringify(db.getCollectionNames())']);
  let collections;
  try { collections = JSON.parse(names.stdout.trim()); }
  catch { throw new Error('Could not verify disposable MongoDB database is empty before migrations.'); }
  if (!Array.isArray(collections) || collections.length !== 0) {
    throw new Error('Refusing to migrate a non-empty disposable test database.');
  }

  await docker(['exec', containerName, 'mkdir', '-p', '/tmp/enlaceseguro-worker-harness']);
  await docker(['cp', path.join(repoRoot, 'database'), `${containerName}:/tmp/enlaceseguro-worker-harness/database`]);
  for (const migration of migrationNames) {
    const vars = `globalThis.EnlaceSeguroExpectedDb='${databaseName}'; globalThis.EnlaceSeguroAnalysisJobMaxPending=${queueMaxPending}; `;
    const file = `/tmp/enlaceseguro-worker-harness/database/migrations/${migration}`;
    await docker(['exec', '--workdir', '/tmp/enlaceseguro-worker-harness', containerName, 'mongosh', mongoUri, '--quiet', '--eval', `${vars}load('${file}')`]);
  }
  const postMigrations = await docker(['exec', containerName, 'mongosh', mongoUri, '--quiet', '--eval', 'JSON.stringify(db.getCollectionNames().sort())']);
  let migratedCollections;
  try { migratedCollections = JSON.parse(postMigrations.stdout.trim()); }
  catch { throw new Error('Could not verify migrated disposable database collections.'); }
  const required = ['analysis_queue_capacity', 'daily_analyses', 'login_rate_limit_buckets', 'refresh_tokens', 'reputation_cache', 'security_audit_events', 'users'];
  assert.deepEqual(migratedCollections, required, 'all expected strict schema collections exist after migrations 001–006');
  const readiness = await docker(['exec', containerName, 'mongosh', mongoUri, '--quiet', '--eval', "JSON.stringify({cap:db.analysis_queue_capacity.findOne({_id:'global'}), indexes:db.daily_analyses.getIndexes().map(i=>i.name)})"]);
  const state = JSON.parse(readiness.stdout.trim());
  assert.equal(state.cap?.maxPending, queueMaxPending, 'migration installed the configured global pending cap');
  assert.ok(state.indexes.includes('ix_daily_analyses_job_claim'), 'durable job claim index exists');
}

async function startMongo() {
  await docker(['info']);
  await docker(['image', 'inspect', dockerImage]);
  mongoPort = await reserveLoopbackPort();
  mongoUri = `mongodb://127.0.0.1:${mongoPort}/${databaseName}?replicaSet=rs0`;
  // mongod needs its container interface for Docker port forwarding; the host-visible publish is loopback-only.
  mongoContainerStarted = true;
  await docker([
    'run', '--rm', '--detach', '--name', containerName,
    '--publish', `127.0.0.1:${mongoPort}:${mongoPort}`,
    dockerImage, 'mongod', '--port', String(mongoPort), '--replSet', 'rs0', '--bind_ip_all'
  ]);
  const directMongoUri = `mongodb://127.0.0.1:${mongoPort}/${databaseName}`;
  await waitFor('MongoDB loopback container readiness', async () => {
    const result = await docker(['exec', containerName, 'mongosh', directMongoUri, '--quiet', '--eval', 'db.adminCommand({ping:1}).ok']);
    return result.stdout.trim() === '1';
  }, 60_000, 500);
  await docker(['exec', containerName, 'mongosh', directMongoUri, '--quiet', '--eval', `rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:${mongoPort}'}]})`]);
  await waitFor('MongoDB single-member replica set primary', async () => {
    const result = await docker(['exec', containerName, 'mongosh', mongoUri, '--quiet', '--eval', 'db.hello().isWritablePrimary']);
    return result.stdout.trim() === 'true';
  }, 60_000, 500);
  await applyMigrations();
  mongoClient = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5_000, maxPoolSize: 5 });
  await mongoClient.connect();
}

async function checkPrerequisitesAndBuild() {
  assert.match(databaseName, /^enlaceseguro_test_worker_[0-9]+_[a-f0-9]+$/);
  assert.ok(!['admin', 'config', 'local'].includes(databaseName));
  await docker(['info']);
  await docker(['image', 'inspect', dockerImage]);
  const build = await runCommand('npm', ['run', 'build'], { cwd: apiRoot, timeout: 60_000 });
  if (build.stderr?.trim()) process.stdout.write(build.stderr.trim() + '\n');
  await readFile(apiEntry);
}

async function runGracefulDrainScenario(api1Base, api2Base, token) {
  const gate = holdNextApiRequest('api1');
  const analysis = await submitAnalysis(api1Base, token, 'graceful');
  const firstCall = await waitForPromise('API1 to claim the graceful-drain job', gate.received.promise, 15_000);
  assert.equal(firstCall.apiLabel, 'api1');
  assert.equal(firstCall.attemptId, analysis.attemptId);
  const before = await waitFor('Mongo lease for graceful job', async () => {
    const state = await getAttemptState(analysis.attemptId);
    return state.attempt.job?.state === 'leased' ? state : false;
  });
  const originalLease = before.attempt.job.leaseToken;
  assert.equal(typeof originalLease, 'string');

  // Start API2 only after API1 owns the lease, so the test proves API2 availability without a claim race.
  api2 = await startApi('api2', api2Port);

  const gracefulExit = api1.exit;
  assert.equal(api1.child.kill('SIGTERM'), true, 'SIGTERM sent only to harness-owned API1 child');
  await waitFor('API1 to begin graceful shutdown', () => processLog(api1).includes('Received SIGTERM.'), 8_000);
  gate.release.resolve();
  const exit = await waitForPromise('API1 graceful drain exit', gracefulExit, 15_000);
  assert.deepEqual(exit, { code: 0, signal: null }, 'API1 exits cleanly after draining the in-flight job');

  const detail = await waitFor('API2 availability and completed shared history', async () => {
    const response = await getDetail(api2Base, token, analysis);
    return response.status === 200 && response.body?.processingStatus === 'completed' ? response : false;
  }, 15_000);
  assert.equal(detail.body.attemptId, analysis.attemptId);
  assert.equal(detail.body.analysis?.verdict, 'sin_amenazas_detectadas');
  assert.equal(requestCalls.filter((call) => call.attemptId === analysis.attemptId).length, 1, 'second worker does not duplicate active leased work');
  console.log('PASS graceful SIGTERM: API1 drained active job; API2 remained available and read shared result.');
}

async function runCrashRecoveryScenario(api1Base, api2Base, token) {
  const gate = holdNextApiRequest('api1');
  const analysis = await submitAnalysis(api1Base, token, 'recovery');
  const firstCall = await waitForPromise('API1 to claim recovery job', gate.received.promise, 15_000);
  assert.equal(firstCall.apiLabel, 'api1');
  assert.equal(firstCall.attemptId, analysis.attemptId);
  const firstClaim = await waitFor('Mongo lease before simulated crash', async () => {
    const state = await getAttemptState(analysis.attemptId);
    return state.attempt.job?.state === 'leased' ? state : false;
  });
  const oldLeaseToken = firstClaim.attempt.job.leaseToken;
  const oldLeaseOwner = firstClaim.attempt.job.leaseOwner;
  assert.equal(typeof oldLeaseToken, 'string');

  const api1Exit = api1.exit;
  assert.equal(api1.child.kill('SIGKILL'), true, 'SIGKILL sent only to harness-owned API1 child');
  const crashed = await api1Exit;
  assert.equal(crashed.signal, 'SIGKILL', 'API1 was terminated as simulated crash');
  await waitFor('API1 lease to become eligible for reclaim', async () => {
    const state = await getAttemptState(analysis.attemptId);
    return state.attempt.job?.leaseExpiresAt instanceof Date && state.attempt.job.leaseExpiresAt <= new Date() ? state : false;
  }, leaseDurationMs + 5_000, 100);

  const api2Gate = holdNextApiRequest('api2');
  api2 = await startApi('api2', api2Port);
  const recoveryCall = await waitForPromise('API2 to reclaim expired lease', api2Gate.received.promise, leaseDurationMs + 10_000);
  assert.equal(recoveryCall.attemptId, analysis.attemptId);
  const recoveredClaim = await waitFor('API2 to install a new fencing token', async () => {
    const state = await getAttemptState(analysis.attemptId);
    return state.attempt.job?.state === 'leased' && state.attempt.job.leaseOwner !== oldLeaseOwner ? state : false;
  }, 5_000, 50);
  assert.notEqual(recoveredClaim.attempt.job.leaseToken, oldLeaseToken, 'API2 claim replaces stale API1 fencing token');
  api2Gate.release.resolve();

  const detail = await waitFor('API2 fenced recovery result', async () => {
    const response = await getDetail(api2Base, token, analysis);
    return response.status === 200 && response.body?.processingStatus === 'completed' ? response : false;
  }, 15_000);
  assert.equal(detail.body.attemptId, analysis.attemptId);
  assert.equal(detail.body.analysis?.verdict, 'sin_amenazas_detectadas');
  const finalState = await getAttemptState(analysis.attemptId);
  assert.equal(finalState.attempt.job.state, 'completed');
  assert.equal(finalState.attempt.job.attemptCount, 2, 'API2 owns the second claim after API1 crash');
  assert.equal(requestCalls.filter((call) => call.attemptId === analysis.attemptId && call.apiLabel === 'api2').length, 1);
  console.log('PASS crash recovery: API2 reclaimed expired job with a new fencing token and completed it.');
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    await Promise.all([...apiChildren].map((child) => stopChild(child, 'SIGTERM', 2_000).catch(() => undefined)));
    if (mongoClient) {
      try { await mongoClient.db(databaseName).dropDatabase(); } catch { /* Container removal is the final isolation boundary. */ }
      try { await mongoClient.close(); } catch { /* Best effort cleanup. */ }
      mongoClient = undefined;
    }
    if (fakeSandbox) {
      try { fakeSandbox.closeAllConnections?.(); } catch { /* Best effort cleanup. */ }
      await new Promise((resolve) => fakeSandbox.close(() => resolve()));
      fakeSandbox = undefined;
    }
    if (mongoContainerStarted) {
      try { await docker(['rm', '--force', containerName], { timeout: 15_000 }); } catch { /* Container may already be removed by --rm. */ }
      mongoContainerStarted = false;
    }
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true });
      tempDirectory = undefined;
    }
  })();
  return cleanupPromise;
}

async function main() {
  tempDirectory = await mkdtemp(path.join(tmpdir(), 'enlaceseguro-worker-harness-'));
  await writeFile(path.join(tempDirectory, 'empty.env'), '', { mode: 0o600 });
  await checkPrerequisitesAndBuild();
  await startMongo();
  await startFakeSandbox();
  api1Port = await reserveLoopbackPort();
  api2Port = await reserveLoopbackPort();
  assert.notEqual(api1Port, api2Port);
  const api1Base = `http://127.0.0.1:${api1Port}`;
  const api2Base = `http://127.0.0.1:${api2Port}`;
  api1 = await startApi('api1', api1Port);
  const token = await registerAndLogin(api1Base);

  await runGracefulDrainScenario(api1Base, api2Base, token);

  await stopChild(api2, 'SIGTERM', 5_000);
  assert.equal(api2.child.exitCode, 0, 'API2 cleanly stops before crash-recovery scenario');
  api1 = await startApi('api1', api1Port);
  await runCrashRecoveryScenario(api1Base, api2Base, token);
  console.log('PASS worker shutdown/recovery harness; all MongoDB data and child processes are disposable and cleaned up.');
}

process.once('SIGINT', () => {
  process.exitCode = 130;
  void cleanup().finally(() => process.exit(130));
});
process.once('SIGTERM', () => {
  process.exitCode = 143;
  void cleanup().finally(() => process.exit(143));
});

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown harness failure.';
  console.error(`FAIL worker shutdown/recovery harness: ${message}`);
  if (api1?.logText) console.error(`API1 log tail: ${api1.logText.split('\n').slice(-12).join('\n')}`);
  if (api2?.logText) console.error(`API2 log tail: ${api2.logText.split('\n').slice(-12).join('\n')}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
