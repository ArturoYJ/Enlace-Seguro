import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { after, describe, it } from 'node:test';
import { AntiSsrfGuard } from '../src/core/AntiSsrfGuard.js';
import { PlaywrightContextPool, SandboxNavigationError } from '../src/infrastructure/PlaywrightContextPool.js';
import { buildSandboxServer } from '../src/presentation/sandboxServer.js';
import type { IScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';

const enabled = process.env['SANDBOX_PROXY_OUTAGE_TEST'] === '1';
const serviceToken = 'synthetic-proxy-outage-service-token-0001';
let fixture: Server | undefined;
let pool: PlaywrightContextPool | undefined;
let server: Awaited<ReturnType<typeof buildSandboxServer>> | undefined;
let requestCount = 0;
let captureWrites = 0;
const originalIsSafeUrl = AntiSsrfGuard.isSafeUrl;
const originalValidateDestination = AntiSsrfGuard.validateDestination;
const originalProxyUrl = process.env['SANDBOX_EGRESS_PROXY_URL'];

const closeHttpServer = async (target: Server | undefined): Promise<void> => {
  if (!target?.listening) return;
  await new Promise<void>((resolve, reject) => target.close((error) => error ? reject(error) : resolve()));
};

const getUnusedLoopbackPort = async (): Promise<number> => {
  const probe = createNetServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a synthetic proxy port.');
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
};

after(async () => {
  await server?.close();
  await pool?.close();
  await closeHttpServer(fixture);
  AntiSsrfGuard.isSafeUrl = originalIsSafeUrl;
  AntiSsrfGuard.validateDestination = originalValidateDestination;
  if (originalProxyUrl === undefined) delete process.env['SANDBOX_EGRESS_PROXY_URL'];
  else process.env['SANDBOX_EGRESS_PROXY_URL'] = originalProxyUrl;
});

describe('Sandbox proxy outage (loopback fixture only)', () => {
  it('fails retryably without direct fallback, verdict, or capture', { skip: !enabled }, async () => {
    fixture = createServer((_request, response) => {
      requestCount++;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><body>DIRECT_FALLBACK_MUST_NOT_HAPPEN</body></html>');
    });
    await new Promise<void>((resolve, reject) => {
      fixture!.once('error', reject);
      fixture!.listen(0, '127.0.0.1', resolve);
    });
    const address = fixture.address();
    if (!address || typeof address === 'string') throw new Error('Could not start the local target fixture.');
    const targetUrl = `http://127.0.0.1:${address.port}/synthetic-target`;
    const proxyPort = await getUnusedLoopbackPort();
    assert.notEqual(proxyPort, address.port);
    process.env['SANDBOX_EGRESS_PROXY_URL'] = `http://127.0.0.1:${proxyPort}`;

    AntiSsrfGuard.isSafeUrl = (value: string) => {
      const parsedUrl = new URL(value);
      if (parsedUrl.origin === `http://127.0.0.1:${address.port}`) return { valid: true, parsedUrl };
      return originalIsSafeUrl.call(AntiSsrfGuard, value);
    };
    AntiSsrfGuard.validateDestination = async (parsedUrl: URL) => {
      if (parsedUrl.origin === `http://127.0.0.1:${address.port}`) {
        return { safe: true, resolvedIp: '127.0.0.1' };
      }
      return originalValidateDestination.call(AntiSsrfGuard, parsedUrl);
    };

    const storage: IScreenshotStorage = {
      async saveScreenshot(attemptId, _buffer) {
        captureWrites++;
        return `local://captures/${attemptId}.webp`;
      },
      async getScreenshot() { return null; }
    };
    pool = new PlaywrightContextPool(storage, 1, undefined, 1, 8_000);

    await assert.rejects(
      pool.analyzeUrl('88888888-8888-4888-8888-888888888881', targetUrl),
      SandboxNavigationError
    );
    assert.equal(requestCount, 0, 'Chromium must not fall back to the direct loopback target');
    assert.equal(captureWrites, 0, 'proxy outage must not save a screenshot');

    server = buildSandboxServer({ pool, storage, serviceToken });
    const response = await server.inject({
      method: 'POST',
      url: '/analyze',
      headers: { authorization: `Bearer ${serviceToken}` },
      payload: {
        attemptId: '88888888-8888-4888-8888-888888888882',
        url: targetUrl
      }
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.headers['retry-after'], '1');
    assert.deepEqual(response.json(), {
      error: 'Bad Gateway',
      message: 'The destination could not be inspected.'
    });
    assert.equal(requestCount, 0, 'API request must not cause direct browser fallback');
    assert.equal(captureWrites, 0, 'API request must not save a screenshot after proxy outage');
  });
});
