import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AntiSsrfGuard } from '../src/core/AntiSsrfGuard.js';
import { PlaywrightContextPool } from '../src/infrastructure/PlaywrightContextPool.js';
import type { IScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';

const attemptId = '33333333-3333-4333-8333-333333333334';
// Each iframe makes a redirect request and a destination request, plus the main document.
// Keep the total at 255 so this test stays below the separate 256-request analysis budget.
const requestCount = 127;
let server: Server | undefined;
let pool: PlaywrightContextPool | undefined;

after(async () => {
  await pool?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
});

describe('Sandbox redirect evidence bound (real Chromium, loopback fixture only)', () => {
  it('retains at most ten redirect locations and marks the evidence as truncated', async () => {
    let redirectsServed = 0;
    let destinationsServed = 0;
    let allFixtureRequestsCompleted = false;

    server = createServer((request, response) => {
      if (request.url === '/') {
        const iframes = Array.from({ length: requestCount }, (_, index) =>
          `<iframe width="1" height="1" src="/redirect/${index}"></iframe>`
        ).join('');
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html><html><body>${iframes}</body></html>`);
        return;
      }
      if (request.url?.startsWith('/redirect/')) {
        redirectsServed++;
        const id = request.url.slice('/redirect/'.length);
        response.writeHead(302, { location: `/destination/${id}` });
        response.end();
        return;
      }
      if (request.url?.startsWith('/destination/')) {
        destinationsServed++;
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html><body>redirect fixture</body></html>');
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    const targetUrl = `http://127.0.0.1:${address.port}/`;
    const originalIsSafeUrl = AntiSsrfGuard.isSafeUrl;
    const originalValidateDestination = AntiSsrfGuard.validateDestination;

    AntiSsrfGuard.isSafeUrl = (value: string) => {
      const parsedUrl = new URL(value);
      if (parsedUrl.hostname === '127.0.0.1' && parsedUrl.port === String(address.port)) {
        return { valid: true, parsedUrl };
      }
      return originalIsSafeUrl.call(AntiSsrfGuard, value);
    };
    AntiSsrfGuard.validateDestination = async (url: URL) => {
      if (url.hostname === '127.0.0.1' && url.port === String(address.port)) {
        return { safe: true, resolvedIp: '127.0.0.1' };
      }
      return originalValidateDestination.call(AntiSsrfGuard, url);
    };

    const waitForAllResponses = async () => {
      const deadline = Date.now() + 18_000;
      while (destinationsServed < requestCount && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      allFixtureRequestsCompleted = redirectsServed === requestCount && destinationsServed === requestCount;
      if (!allFixtureRequestsCompleted) throw new Error('Loopback redirect fixture did not finish within its test bound.');
      return `local://captures/${attemptId}.webp`;
    };

    pool = new PlaywrightContextPool({
      async saveScreenshot() { return waitForAllResponses(); },
      async getScreenshot() { return null; }
    } satisfies IScreenshotStorage, 1, undefined, 1, 22_000);

    try {
      await pool.init(10_000);
      const result = await pool.analyzeUrl(attemptId, targetUrl);
      assert.equal(result.outcome, 'completed');
      if (result.outcome !== 'completed') return;
      assert.equal(allFixtureRequestsCompleted, true);
      assert.equal(result.redirects.length, 10);
      assert.equal(result.signals.includes('excessive_redirect_chain'), true);
      assert.equal(result.signals.includes('redirect_evidence_truncated'), true);
      assert.equal(redirectsServed, requestCount);
      assert.equal(destinationsServed, requestCount);
    } finally {
      AntiSsrfGuard.isSafeUrl = originalIsSafeUrl;
      AntiSsrfGuard.validateDestination = originalValidateDestination;
    }
  });
});
