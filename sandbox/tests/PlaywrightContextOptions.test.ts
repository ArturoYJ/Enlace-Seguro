import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlaywrightContextOptions,
  PLAYWRIGHT_CONTEXT_OPTIONS,
  resolveEgressProxySettings
} from '../src/infrastructure/playwrightContextOptions.js';
import { PlaywrightContextPool } from '../src/infrastructure/PlaywrightContextPool.js';
import type { IScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';

describe('Playwright context policy', () => {
  it('does not accept download files into the browser context', () => {
    assert.equal(PLAYWRIGHT_CONTEXT_OPTIONS.acceptDownloads, false);
  });

  it('blocks registration of service workers in untrusted pages', () => {
    assert.equal(PLAYWRIGHT_CONTEXT_OPTIONS.serviceWorkers, 'block');
  });

  it('rejects HTTPS certificates Chromium cannot validate', () => {
    assert.equal(PLAYWRIGHT_CONTEXT_OPTIONS.ignoreHTTPSErrors, false);
  });

  it('fails closed in production when no outbound proxy is configured', () => {
    assert.throws(
      () => resolveEgressProxySettings({ NODE_ENV: 'production' }),
      /SANDBOX_EGRESS_PROXY_URL is required when NODE_ENV=production/
    );
  });

  it('does not construct a production pool without an outbound proxy', () => {
    const previousNodeEnv = process.env['NODE_ENV'];
    const previousProxyUrl = process.env['SANDBOX_EGRESS_PROXY_URL'];
    process.env['NODE_ENV'] = 'production';
    delete process.env['SANDBOX_EGRESS_PROXY_URL'];
    try {
      assert.throws(
        () => new PlaywrightContextPool({} as IScreenshotStorage),
        /SANDBOX_EGRESS_PROXY_URL is required when NODE_ENV=production/
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = previousNodeEnv;
      if (previousProxyUrl === undefined) delete process.env['SANDBOX_EGRESS_PROXY_URL'];
      else process.env['SANDBOX_EGRESS_PROXY_URL'] = previousProxyUrl;
    }
  });

  it('allows an absent proxy only outside production for local development and tests', () => {
    assert.equal(resolveEgressProxySettings({ NODE_ENV: 'test' }), undefined);
    assert.equal(resolveEgressProxySettings({ NODE_ENV: 'development' }), undefined);
  });

  it('configures the context proxy without a bypass list', () => {
    const proxy = resolveEgressProxySettings({
      NODE_ENV: 'production',
      SANDBOX_EGRESS_PROXY_URL: 'http://proxy-user:proxy-pass@egress.example:3128'
    });
    const options = createPlaywrightContextOptions(proxy);

    assert.deepEqual(options.proxy, {
      server: 'http://egress.example:3128',
      username: 'proxy-user',
      password: 'proxy-pass'
    });
    assert.equal(options.proxy && 'bypass' in options.proxy, false);
    assert.equal(options.ignoreHTTPSErrors, false);
  });

  it('rejects malformed proxy URLs instead of silently disabling proxying', () => {
    assert.throws(
      () => resolveEgressProxySettings({ NODE_ENV: 'production', SANDBOX_EGRESS_PROXY_URL: 'proxy.internal' }),
      /must be an absolute proxy URL/
    );
    assert.throws(
      () => resolveEgressProxySettings({ NODE_ENV: 'production', SANDBOX_EGRESS_PROXY_URL: 'ftp://proxy.internal:21' }),
      /must use http or https/
    );
    assert.throws(
      () => resolveEgressProxySettings({ NODE_ENV: 'production', SANDBOX_EGRESS_PROXY_URL: 'socks5://proxy.internal:1080' }),
      /must use http or https/
    );
    for (const value of [
      'http://proxy.internal:10000/forward',
      'http://proxy.internal:10000/?target=example.test',
      'http://proxy.internal:10000/#fragment'
    ]) {
      assert.throws(
        () => resolveEgressProxySettings({ NODE_ENV: 'production', SANDBOX_EGRESS_PROXY_URL: value }),
        /must not include a path, query, or fragment/
      );
    }
  });
});
