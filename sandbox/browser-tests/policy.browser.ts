import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { chromium, Browser, BrowserContext } from 'playwright';
import { PLAYWRIGHT_CONTEXT_OPTIONS } from '../src/infrastructure/playwrightContextOptions.js';
import { LocalScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';

describe('Playwright browser context policy (real Chromium, loopback only)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let server: Server;
  let baseUrl: string;
  let serviceWorkerRequests = 0;
  let attachmentRequests = 0;

  before(async () => {
    server = createServer((request, response) => {
      if (request.url === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html><html><body>
          <a id="download" href="/attachment">Download</a>
          <script>
            window.serviceWorkerRegistration = navigator.serviceWorker.register('/sw.js')
              .then(() => 'registered')
              .catch((error) => error.name);
          </script>
        </body></html>`);
        return;
      }
      if (request.url === '/sw.js') {
        serviceWorkerRequests++;
        response.writeHead(200, { 'content-type': 'application/javascript' });
        response.end("self.addEventListener('fetch', () => {});");
        return;
      }
      if (request.url === '/attachment') {
        attachmentRequests++;
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="policy-test.bin"'
        });
        response.end('non-sensitive test bytes');
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext(PLAYWRIGHT_CONTEXT_OPTIONS);
  });

  after(async () => {
    await context?.close();
    await browser?.close();
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('blocks service-worker registration on an actual browser page', async () => {
    const page = await context.newPage();
    await page.goto(baseUrl);
    await page.evaluate(() =>
      (window as Window & { serviceWorkerRegistration: Promise<string> }).serviceWorkerRegistration
    );
    const registrationCount = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    assert.equal(registrationCount, 0);
    assert.equal(serviceWorkerRequests, 0, 'the browser must not fetch the service-worker script');
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller === null), true);
    await page.close();
  });

  it('produces genuine WebP bytes for the capture contract', async () => {
    const page = await context.newPage();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'enlaceseguro-webp-browser-'));
    try {
      await page.goto(baseUrl);
      const capture = await page.screenshot({ type: 'webp', fullPage: false });
      assert.equal(capture.toString('ascii', 0, 4), 'RIFF');
      assert.equal(capture.toString('ascii', 8, 12), 'WEBP');
      const storage = new LocalScreenshotStorage(dir);
      const attemptId = 'f555327e-9f10-41b5-ac92-8ef5205ca936';
      assert.equal(await storage.saveScreenshot(attemptId, capture), `local://captures/${attemptId}.webp`);
      assert.deepEqual(await storage.getScreenshot(attemptId), capture);
    } finally {
      await page.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('does not accept a download from a loopback response', async () => {
    const page = await context.newPage();
    await page.goto(baseUrl);
    const downloadEvent = page.waitForEvent('download', { timeout: 1500 }).then((download) => download).catch(() => null);
    await page.locator('#download').click();
    const download = await downloadEvent;
    assert.equal(attachmentRequests, 1, 'fixture should exercise an actual attachment response');

    // Chromium may emit an event for a rejected attachment depending on its version;
    // if so, the BrowserContext must still deny a persisted download path.
    if (download) {
      await assert.rejects(download.path());
    }
    assert.equal(PLAYWRIGHT_CONTEXT_OPTIONS.acceptDownloads, false);
    await page.close();
  });
});
