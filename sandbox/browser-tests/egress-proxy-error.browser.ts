import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { AntiSsrfGuard } from '../src/core/AntiSsrfGuard.js';
import { PlaywrightContextPool, SandboxNavigationError } from '../src/infrastructure/PlaywrightContextPool.js';
import type { IScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';

let server: Server | undefined;
let pool: PlaywrightContextPool | undefined;

const closeServer = async (target: Server | undefined): Promise<void> => {
  if (!target?.listening) return;
  await new Promise<void>((resolve, reject) => target.close((error) => error ? reject(error) : resolve()));
};

after(async () => {
  await pool?.close();
  await closeServer(server);
});

describe('egress proxy denial marker (real Chromium, local fixture only)', () => {
  it('fails retryably on marked main/subresource responses but preserves ordinary 403/5xx pages', async () => {
    server = createServer((request, response) => {
      switch (request.url) {
        case '/marked-main':
          response.writeHead(502, {
            'content-type': 'text/html; charset=utf-8',
            'x-enlaceseguro-egress-error': 'true'
          });
          response.end('<!doctype html><html><body><input type="password"></body></html>');
          return;
        case '/marked-subresource':
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body><input type="password"><img src="/marked-image"></body></html>');
          return;
        case '/marked-image':
          response.writeHead(502, {
            'content-type': 'image/svg+xml',
            'x-enlaceseguro-egress-error': 'true'
          });
          response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
          return;
        case '/ordinary-403':
          response.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
          response.end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body>Forbidden</body></html>');
          return;
        case '/ordinary-503':
          response.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
          response.end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body>Unavailable</body></html>');
          return;
        default:
          response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;
    const originalIsSafeUrl = AntiSsrfGuard.isSafeUrl;
    const originalValidateDestination = AntiSsrfGuard.validateDestination;
    let captureWrites = 0;

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
    } satisfies IScreenshotStorage, 1, undefined, 1, 10_000);

    try {
      await assert.rejects(
        pool.analyzeUrl('99999999-9999-4999-8999-999999999991', `http://127.0.0.1:${port}/marked-main`),
        SandboxNavigationError
      );
      await assert.rejects(
        pool.analyzeUrl('99999999-9999-4999-8999-999999999992', `http://127.0.0.1:${port}/marked-subresource`),
        SandboxNavigationError
      );
      assert.equal(captureWrites, 0, 'proxy error responses must never persist a screenshot');

      for (const [index, status] of ['403', '503'].entries()) {
        const ordinary = await pool.analyzeUrl(
          `99999999-9999-4999-8999-99999999999${index + 3}`,
          `http://127.0.0.1:${port}/ordinary-${status}`
        );
        assert.equal(ordinary.outcome, 'completed');
        if (ordinary.outcome !== 'completed') assert.fail('Ordinary upstream status must remain analyzable.');
        assert.equal(ordinary.verdict, 'sin_amenazas_detectadas');
      }
      assert.equal(captureWrites, 2, 'ordinary unmarked HTTP errors remain eligible for screenshot capture');
    } finally {
      AntiSsrfGuard.isSafeUrl = originalIsSafeUrl;
      AntiSsrfGuard.validateDestination = originalValidateDestination;
    }
  });
});
