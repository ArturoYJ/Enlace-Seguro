import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import { AntiSsrfGuard } from '../src/core/AntiSsrfGuard.js';
import { PlaywrightContextPool } from '../src/infrastructure/PlaywrightContextPool.js';
import type { IScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';

const attemptId = '77777777-7777-4777-8777-777777777777';
let pageServer: HttpServer | undefined;
let tlsServer: HttpsServer | undefined;
let pool: PlaywrightContextPool | undefined;

const listenOnLoopback = async (server: HttpServer | HttpsServer): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
};

const closeServer = async (server: HttpServer | HttpsServer | undefined): Promise<void> => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
};

after(async () => {
  await pool?.close();
  await Promise.all([closeServer(pageServer), closeServer(tlsServer)]);
});

describe('PlaywrightContextPool subresource TLS policy characterization (loopback fixtures only)', () => {
  it('returns inconclusive without a verdict or capture when image and iframe certificates are untrusted', async () => {
    const [key, cert] = await Promise.all([
      readFile(new URL('./fixtures/localhost.key.pem', import.meta.url)),
      readFile(new URL('./fixtures/localhost.cert.pem', import.meta.url))
    ]);
    let secureConnections = 0;
    let tcpConnections = 0;
    let tlsRequests = 0;
    let pageRequests = 0;
    let tlsRouteChecks = 0;
    let captureWrites = 0;
    tlsServer = createHttpsServer({ key, cert }, (_request, response) => {
      tlsRequests++;
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    });
    tlsServer.on('connection', () => { tcpConnections++; });
    tlsServer.on('secureConnection', () => { secureConnections++; });
    const tlsPort = await listenOnLoopback(tlsServer);

    pageServer = createHttpServer((_request, response) => {
      pageRequests++;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      const imageUrl = `https://127.0.0.1:${tlsPort}/untrusted.svg`;
      response.end(`<!doctype html><html><body><img src="${imageUrl}"><iframe src="${imageUrl}"></iframe></body></html>`);
    });
    const pagePort = await listenOnLoopback(pageServer);
    const allowedFixturePorts = new Set([String(pagePort), String(tlsPort)]);
    const targetUrl = `http://127.0.0.1:${pagePort}/`;
    const originalIsSafeUrl = AntiSsrfGuard.isSafeUrl;
    const originalValidateDestination = AntiSsrfGuard.validateDestination;

    AntiSsrfGuard.isSafeUrl = (value: string) => {
      const parsedUrl = new URL(value);
      if (parsedUrl.hostname === '127.0.0.1' && allowedFixturePorts.has(parsedUrl.port)) {
        if (parsedUrl.port === String(tlsPort)) tlsRouteChecks++;
        return { valid: true, parsedUrl };
      }
      return originalIsSafeUrl.call(AntiSsrfGuard, value);
    };
    AntiSsrfGuard.validateDestination = async (url: URL) => {
      if (url.hostname === '127.0.0.1' && allowedFixturePorts.has(url.port)) {
        return { safe: true, resolvedIp: '127.0.0.1' };
      }
      return originalValidateDestination.call(AntiSsrfGuard, url);
    };

    pool = new PlaywrightContextPool({
      async saveScreenshot() {
        captureWrites++;
        return `local://captures/${attemptId}.webp`;
      },
      async getScreenshot() { return null; }
    } satisfies IScreenshotStorage, 1, undefined, 1, 8_000);

    try {
      const result = await pool.analyzeUrl(attemptId, targetUrl);

      assert.equal(pageRequests, 1);
      assert.equal(tlsRouteChecks, 2, 'Chromium must route both image and iframe requests through the guard.');
      assert.ok(tcpConnections > 0, 'Chromium must open a TCP connection to the local TLS image fixture.');
      assert.equal(secureConnections, 0, 'Chromium must reject the untrusted fixture certificate.');
      assert.equal(tlsRequests, 0, 'The untrusted image certificate must stop HTTP before the request arrives.');
      assert.equal(result.outcome, 'inconclusive');
      if (result.outcome !== 'inconclusive') assert.fail('Expected a no-verdict inconclusive result.');
      assert.equal(result.reasonCode, 'tls_certificate_invalid');
      assert.deepEqual(result.signals, ['tls_certificate_validation_failed']);
      assert.deepEqual(result.sourceResults, []);
      assert.equal('verdict' in result, false);
      assert.equal('screenshotRef' in result, false);
      assert.equal(captureWrites, 0);
    } finally {
      AntiSsrfGuard.isSafeUrl = originalIsSafeUrl;
      AntiSsrfGuard.validateDestination = originalValidateDestination;
    }
  });
});
