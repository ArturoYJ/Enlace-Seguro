import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer, Server } from 'node:https';
import { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { chromium, Browser, BrowserContext } from 'playwright';
import { PLAYWRIGHT_CONTEXT_OPTIONS } from '../src/infrastructure/playwrightContextOptions.js';

describe('Playwright TLS policy (real Chromium, local self-signed fixture only)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let server: Server;
  let url: string;
  let documentRequests = 0;

  before(async () => {
    const [key, cert] = await Promise.all([
      readFile(new URL('./fixtures/localhost.key.pem', import.meta.url)),
      readFile(new URL('./fixtures/localhost.cert.pem', import.meta.url))
    ]);
    server = createServer({ key, cert }, (_request, response) => {
      documentRequests += 1;
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><script>window.testPageLoaded = true</script>');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext(PLAYWRIGHT_CONTEXT_OPTIONS);
  });

  after(async () => {
    await context?.close();
    await browser?.close();
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('does not load a main document with an untrusted certificate', async () => {
    const page = await context.newPage();
    await assert.rejects(page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5_000 }), /ERR_CERT_/);
    assert.equal(documentRequests, 0, 'TLS must fail before the server receives the document request');
    await page.close();
  });
});
