import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { AntiSsrfGuard } from '../src/core/AntiSsrfGuard.js';
import { PlaywrightContextPool, SandboxNavigationError } from '../src/infrastructure/PlaywrightContextPool.js';
import { createPlaywrightContextOptions, resolveEgressProxySettings } from '../src/infrastructure/playwrightContextOptions.js';
import type { IScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';

const integrationEnabled = process.env['ENVOY_INTEGRATION_TEST'] === '1';
const targetUrl = process.env['ENVOY_INTEGRATION_TARGET_URL'] ?? 'http://private-canary/synthetic';
let browser: Browser | undefined;
let browserContext: BrowserContext | undefined;
let pool: PlaywrightContextPool | undefined;
const originalIsSafeUrl = AntiSsrfGuard.isSafeUrl;
const originalValidateDestination = AntiSsrfGuard.validateDestination;

after(async () => {
  await pool?.close();
  await browserContext?.close();
  await browser?.close();
  AntiSsrfGuard.isSafeUrl = originalIsSafeUrl;
  AntiSsrfGuard.validateDestination = originalValidateDestination;
});

describe('Chromium and Envoy egress integration (synthetic Docker target only)', () => {
  it('uses Envoy for a synthetic DNS-rebinding destination and fails closed without capture', { skip: !integrationEnabled }, async () => {
    assert.ok(process.env['SANDBOX_EGRESS_PROXY_URL'], 'integration must configure SANDBOX_EGRESS_PROXY_URL');
    const parsedTarget = new URL(targetUrl);
    assert.equal(parsedTarget.hostname, 'private-canary', 'integration target must use the isolated Docker alias');
    assert.equal(parsedTarget.protocol, 'http:');

    // Model the TOCTOU split with a synthetic preflight result; no real DNS lookup
    // or public destination is used. Envoy resolves the name to its private canary.
    AntiSsrfGuard.isSafeUrl = (value: string) => {
      const parsedUrl = new URL(value);
      if (parsedUrl.hostname === parsedTarget.hostname) return { valid: true, parsedUrl };
      return originalIsSafeUrl.call(AntiSsrfGuard, value);
    };
    AntiSsrfGuard.validateDestination = async (url: URL) => {
      if (url.hostname === parsedTarget.hostname) return { safe: true, resolvedIp: '198.51.100.23' };
      return originalValidateDestination.call(AntiSsrfGuard, url);
    };

    const proxy = resolveEgressProxySettings();
    assert.ok(proxy, 'integration requires an outbound proxy');
    browser = await chromium.launch({ headless: true, chromiumSandbox: true });

    browserContext = await browser.newContext(createPlaywrightContextOptions(proxy));
    const page = await browserContext.newPage();
    let envoyDenial: { status: number; marker: string | undefined } | undefined;
    page.on('response', (response) => {
      if (response.url() === targetUrl) {
        envoyDenial = {
          status: response.status(),
          marker: response.headers()['x-enlaceseguro-egress-error']
        };
      }
    });
    await page.goto(targetUrl, { waitUntil: 'load', timeout: 8_000 });
    assert.deepEqual(envoyDenial, { status: 503, marker: 'true' }, 'Chromium must receive Envoy local denial marker');
    await browserContext.close();
    browserContext = undefined;

    let captureWrites = 0;
    pool = new PlaywrightContextPool({
      async saveScreenshot(attemptId, _buffer) {
        captureWrites++;
        return `local://captures/${attemptId}.webp`;
      },
      async getScreenshot() { return null; }
    } satisfies IScreenshotStorage, 1, undefined, 1, 8_000);

    await assert.rejects(
      pool.analyzeUrl('77777777-7777-4777-8777-777777777777', targetUrl),
      SandboxNavigationError
    );
    assert.equal(captureWrites, 0, 'Envoy denials must not create a screenshot');
  });
});
