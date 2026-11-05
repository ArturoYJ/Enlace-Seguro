import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AntiSsrfGuard } from '../src/core/AntiSsrfGuard.js';
import { PlaywrightContextPool, SandboxAnalysisTimeoutError } from '../src/infrastructure/PlaywrightContextPool.js';
import type { IScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';

const attemptId = '33333333-3333-4333-8333-333333333333';
let server: Server | undefined;
let pool: PlaywrightContextPool | undefined;

after(async () => {
  await pool?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
});

describe('Playwright global analysis deadline (real Chromium, loopback fixture only)', () => {
  it('rejects a stalled navigation and closes its browser context without returning a verdict', async () => {
    let requestReceived!: () => void;
    let responseClosed!: () => void;
    const received = new Promise<void>((resolve) => { requestReceived = resolve; });
    const closed = new Promise<void>((resolve) => { responseClosed = resolve; });
    server = createServer((_request, response) => {
      requestReceived();
      response.on('close', () => responseClosed());
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.flushHeaders();
      response.write('<!doctype html><html><body>fixture');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const targetUrl = `http://127.0.0.1:${address.port}/slow`;

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
      if (url.hostname === '127.0.0.1' && url.port === String(address.port)) return { safe: true, resolvedIp: '127.0.0.1' };
      return originalValidateDestination.call(AntiSsrfGuard, url);
    };

    pool = new PlaywrightContextPool({
      async saveScreenshot() { throw new Error('A timed-out navigation must not save a screenshot.'); },
      async getScreenshot() { return null; }
    } satisfies IScreenshotStorage, 1, undefined, 1, 1_000);

    try {
      await pool.init(10_000);
      const analysis = pool.analyzeUrl(attemptId, targetUrl);
      await received;
      await assert.rejects(analysis, SandboxAnalysisTimeoutError);
      await closed;

      const internals = pool as unknown as { activeJobs: number };
      const cleanupDeadline = Date.now() + 2_000;
      while (internals.activeJobs !== 0 && Date.now() < cleanupDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(internals.activeJobs, 0);
    } finally {
      AntiSsrfGuard.isSafeUrl = originalIsSafeUrl;
      AntiSsrfGuard.validateDestination = originalValidateDestination;
    }
  });
});
