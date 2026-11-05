import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { AntiSsrfGuard } from '../src/core/AntiSsrfGuard.js';
import { PlaywrightContextPool } from '../src/infrastructure/PlaywrightContextPool.js';
import type { IScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';

const attemptId = '66666666-6666-4666-8666-666666666666';
let pool: PlaywrightContextPool | undefined;
let server: Server | undefined;

after(async () => {
  await pool?.close();
  await new Promise<void>((resolve, reject) => {
    if (!server?.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe('PlaywrightContextPool main-document TLS policy (real Chromium, local fixture only)', () => {
  it('returns inconclusive on an untrusted certificate without DOM signals, verdict, or capture', async () => {
    const [key, cert] = await Promise.all([
      readFile(new URL('./fixtures/localhost.key.pem', import.meta.url)),
      readFile(new URL('./fixtures/localhost.cert.pem', import.meta.url))
    ]);
    let documentRequests = 0;
    server = createServer({ key, cert }, (_request, response) => {
      documentRequests += 1;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><input type="password"><iframe src="http://127.0.0.1/">`);
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    const targetUrl = `https://127.0.0.1:${address.port}/`;
    const originalIsSafeUrl = AntiSsrfGuard.isSafeUrl;
    const originalValidateDestination = AntiSsrfGuard.validateDestination;
    let captureWrites = 0;

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
    pool = new PlaywrightContextPool({
      async saveScreenshot() {
        captureWrites += 1;
        throw new Error('TLS-inconclusive analysis must not save a screenshot.');
      },
      async getScreenshot() { return null; }
    } satisfies IScreenshotStorage, 1, undefined, 1, 10_000);

    try {
      const result = await pool.analyzeUrl(attemptId, targetUrl);

      assert.equal(result.outcome, 'inconclusive');
      if (result.outcome !== 'inconclusive') assert.fail('Expected TLS-inconclusive result.');
      assert.equal(result.reasonCode, 'tls_certificate_invalid');
      assert.deepEqual(result.signals, ['tls_certificate_validation_failed']);
      assert.deepEqual(result.redirects, []);
      assert.deepEqual(result.sourceResults, []);
      assert.equal('verdict' in result, false);
      assert.equal('screenshotRef' in result, false);
      assert.equal(captureWrites, 0);
      assert.equal(documentRequests, 0, 'TLS must fail before the local server receives the document request');
      assert.equal((pool as unknown as { activeJobs: number }).activeJobs, 0);
    } finally {
      AntiSsrfGuard.isSafeUrl = originalIsSafeUrl;
      AntiSsrfGuard.validateDestination = originalValidateDestination;
    }
  });
});
