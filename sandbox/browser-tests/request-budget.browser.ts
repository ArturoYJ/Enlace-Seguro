import assert from 'node:assert/strict';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { AntiSsrfGuard } from '../src/core/AntiSsrfGuard.js';
import { PlaywrightContextPool } from '../src/infrastructure/PlaywrightContextPool.js';
import type { IScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';

let pageServer: HttpServer | undefined;
let pool: PlaywrightContextPool | undefined;

const listenOnLoopback = async (server: HttpServer): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
};

const closeServer = async (server: HttpServer | undefined): Promise<void> => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
};

after(async () => {
  await pool?.close();
  await closeServer(pageServer);
});

describe('Playwright browser request budget (real Chromium, loopback fixtures only)', () => {
  it('allows request 256 and returns inconclusive without verdict or capture on request 257', async () => {
    const served = new Map<string, number>();
    let captureWrites = 0;
    pageServer = createHttpServer((request, response) => {
      const [, pageNumber, imageNumber] = request.url?.match(/^\/(?:page|image)\/(256|257)(?:\/(\d+))?$/) ?? [];
      const group = pageNumber ?? 'unknown';
      served.set(group, (served.get(group) ?? 0) + 1);

      if (request.url === '/page/256' || request.url === '/page/257') {
        const pageBudget = Number(request.url.split('/').at(-1));
        // The over-limit case reaches 256 HTTP requests, then attempts a 257th request as a WebSocket.
        const imageCount = pageBudget === 257 ? 255 : pageBudget - 1;
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html><html><head><link rel="icon" href="data:,"></head><body>${Array.from(
          { length: imageCount },
          (_, index) => `<img src="/image/${pageBudget}/${index}">`
        ).join('')}${pageBudget === 257 ? '<script>addEventListener("load", () => new WebSocket("ws://" + location.host + "/socket"))</script>' : ''}</body></html>`);
        return;
      }

      if (imageNumber !== undefined) {
        response.writeHead(200, { 'content-type': 'image/svg+xml' });
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
        return;
      }

      response.writeHead(404).end();
    });
    const port = await listenOnLoopback(pageServer);
    const originalIsSafeUrl = AntiSsrfGuard.isSafeUrl;
    const originalValidateDestination = AntiSsrfGuard.validateDestination;
    AntiSsrfGuard.isSafeUrl = (value: string) => {
      const parsedUrl = new URL(value);
      if (parsedUrl.hostname === '127.0.0.1' && parsedUrl.port === String(port)) return { valid: true, parsedUrl };
      return originalIsSafeUrl.call(AntiSsrfGuard, value);
    };
    AntiSsrfGuard.validateDestination = async (url: URL) => {
      if (url.hostname === '127.0.0.1' && url.port === String(port)) return { safe: true, resolvedIp: '127.0.0.1' };
      return originalValidateDestination.call(AntiSsrfGuard, url);
    };

    pool = new PlaywrightContextPool({
      async saveScreenshot(attemptId, _buffer) {
        captureWrites++;
        return `local://captures/${attemptId}.webp`;
      },
      async getScreenshot() { return null; }
    } satisfies IScreenshotStorage, 1, undefined, 1, 20_000);

    try {
      const atLimit = await pool.analyzeUrl('88888888-8888-4888-8888-888888888256', `http://127.0.0.1:${port}/page/256`);
      assert.equal(atLimit.outcome, 'completed');
      assert.equal('verdict' in atLimit, true);
      assert.equal(served.get('256'), 256, 'one document plus 255 subresources must be admitted');
      assert.equal(captureWrites, 1);

      const overLimit = await pool.analyzeUrl('88888888-8888-4888-8888-888888888257', `http://127.0.0.1:${port}/page/257`);
      assert.equal(overLimit.outcome, 'inconclusive');
      if (overLimit.outcome !== 'inconclusive') assert.fail('Expected a no-verdict inconclusive result.');
      assert.equal(overLimit.reasonCode, 'resource_limit_exceeded');
      assert.deepEqual(overLimit.signals, ['browser_request_limit_exceeded']);
      assert.equal('verdict' in overLimit, false);
      assert.equal('screenshotRef' in overLimit, false);
      assert.equal(served.get('257'), 256, 'the 257th request is the WebSocket and must not reach the loopback HTTP server');
      assert.equal(captureWrites, 1, 'over-budget analysis must not persist a capture');
    } finally {
      AntiSsrfGuard.isSafeUrl = originalIsSafeUrl;
      AntiSsrfGuard.validateDestination = originalValidateDestination;
    }
  });
});
