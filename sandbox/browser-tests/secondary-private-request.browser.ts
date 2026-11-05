import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AntiSsrfGuard } from '../src/core/AntiSsrfGuard.js';
import { PlaywrightContextPool } from '../src/infrastructure/PlaywrightContextPool.js';
import type { IScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';

const attemptId = '55555555-5555-4555-8555-555555555555';
let targetServer: Server | undefined;
let privateServer: Server | undefined;
let pool: PlaywrightContextPool | undefined;

const listenOnLoopback = async (server: Server): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
};

const closeServer = async (server: Server | undefined): Promise<void> => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
};

after(async () => {
  await pool?.close();
  await Promise.all([closeServer(targetServer), closeServer(privateServer)]);
});

describe('Sandbox secondary private request guard (real Chromium, loopback fixtures only)', () => {
  it('blocks private IPs requested by images and iframes before they reach the destination', async () => {
    let privateRequestsServed = 0;
    targetServer = createServer((request, response) => {
      if (request.url?.startsWith('/?resource=')) {
        const resourceType = new URL(request.url, 'http://fixture.local').searchParams.get('resource');
        const privateUrl = `http://127.0.0.1:${privatePort}/private-resource`;
        const resource = resourceType === 'iframe'
          ? `<iframe src="${privateUrl}"></iframe>`
          : `<img src="${privateUrl}" alt="fixture">`;
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html><html><body>${resource}</body></html>`);
        return;
      }
      response.writeHead(404).end();
    });
    privateServer = createServer((_request, response) => {
      privateRequestsServed++;
      response.writeHead(200, { 'content-type': 'text/plain' }).end('must not be reached');
    });

    const privatePort = await listenOnLoopback(privateServer);
    const targetPort = await listenOnLoopback(targetServer);
    const targetUrl = `http://127.0.0.1:${targetPort}`;
    const originalIsSafeUrl = AntiSsrfGuard.isSafeUrl;
    const originalValidateDestination = AntiSsrfGuard.validateDestination;
    let privateRouteChecks = 0;

    AntiSsrfGuard.isSafeUrl = (value: string) => {
      const parsedUrl = new URL(value);
      if (parsedUrl.hostname === '127.0.0.1' && parsedUrl.port === String(targetPort)) {
        return { valid: true, parsedUrl };
      }
      if (parsedUrl.hostname === '127.0.0.1' && parsedUrl.port === String(privatePort)) {
        privateRouteChecks++;
      }
      return originalIsSafeUrl.call(AntiSsrfGuard, value);
    };
    AntiSsrfGuard.validateDestination = async (url: URL) => {
      if (url.hostname === '127.0.0.1' && url.port === String(targetPort)) {
        return { safe: true, resolvedIp: '127.0.0.1' };
      }
      return originalValidateDestination.call(AntiSsrfGuard, url);
    };

    pool = new PlaywrightContextPool({
      async saveScreenshot() {
        return `local://captures/${attemptId}.webp`;
      },
      async getScreenshot() { return null; }
    } satisfies IScreenshotStorage, 1, undefined, 1, 8_000);

    try {
      await pool.init(5_000);
      for (const [index, resourceType] of ['image', 'iframe'].entries()) {
        const result = await pool.analyzeUrl(
          `${attemptId.slice(0, -1)}${index + 1}`,
          `${targetUrl}/?resource=${resourceType}`
        );
        assert.equal(result.outcome, 'completed');
        if (result.outcome !== 'completed') return;
        assert.equal(privateRouteChecks, index + 1, `Chromium must submit the ${resourceType} request to the guard.`);
        assert.equal(result.signals.includes('ssrf_attempt_blocked'), true);
        assert.equal(result.verdict, 'peligroso');
      }
      assert.equal(privateRequestsServed, 0);
    } finally {
      AntiSsrfGuard.isSafeUrl = originalIsSafeUrl;
      AntiSsrfGuard.validateDestination = originalValidateDestination;
    }
  });
});
