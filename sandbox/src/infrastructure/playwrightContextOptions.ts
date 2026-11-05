import type { BrowserContextOptions } from 'playwright';

export const PLAYWRIGHT_CONTEXT_OPTIONS: Pick<
  BrowserContextOptions,
  'userAgent' | 'viewport' | 'javaScriptEnabled' | 'bypassCSP' | 'ignoreHTTPSErrors' | 'acceptDownloads' | 'permissions' | 'serviceWorkers'
> = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EnlaceSeguroBot/1.0',
  viewport: { width: 1280, height: 800 },
  javaScriptEnabled: true,
  bypassCSP: false,
  ignoreHTTPSErrors: false,
  acceptDownloads: false,
  serviceWorkers: 'block',
  permissions: []
};

/**
 * Resolves the outbound proxy used by every untrusted browser context.
 * Local development and tests may omit it; production must never start without it.
 */
export function resolveEgressProxySettings(
  env: NodeJS.ProcessEnv = process.env
): BrowserContextOptions['proxy'] | undefined {
  const configuredUrl = env['SANDBOX_EGRESS_PROXY_URL']?.trim();
  if (!configuredUrl) {
    if (env['NODE_ENV'] === 'production') {
      throw new Error('SANDBOX_EGRESS_PROXY_URL is required when NODE_ENV=production.');
    }
    return undefined;
  }

  let proxyUrl: URL;
  try {
    proxyUrl = new URL(configuredUrl);
  } catch {
    throw new Error('SANDBOX_EGRESS_PROXY_URL must be an absolute proxy URL.');
  }

  if (!['http:', 'https:'].includes(proxyUrl.protocol) || !proxyUrl.hostname) {
    throw new Error('SANDBOX_EGRESS_PROXY_URL must use http or https and include a host.');
  }
  if (proxyUrl.pathname !== '/' || proxyUrl.search || proxyUrl.hash) {
    throw new Error('SANDBOX_EGRESS_PROXY_URL must not include a path, query, or fragment.');
  }

  const proxy: NonNullable<BrowserContextOptions['proxy']> = {
    server: `${proxyUrl.protocol}//${proxyUrl.host}`
  };
  if (proxyUrl.username) proxy.username = decodeURIComponent(proxyUrl.username);
  if (proxyUrl.password) proxy.password = decodeURIComponent(proxyUrl.password);
  return proxy;
}

export function createPlaywrightContextOptions(
  proxy?: BrowserContextOptions['proxy']
): BrowserContextOptions {
  return proxy
    ? { ...PLAYWRIGHT_CONTEXT_OPTIONS, proxy }
    : { ...PLAYWRIGHT_CONTEXT_OPTIONS };
}
