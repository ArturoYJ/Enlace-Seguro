import assert from 'node:assert/strict';
import { Resolver } from 'node:dns/promises';
import { after, describe, it } from 'node:test';
import { AntiSsrfGuard } from '../src/core/AntiSsrfGuard.js';
import { PlaywrightContextPool } from '../src/infrastructure/PlaywrightContextPool.js';
import type { IScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';
import { buildSandboxServer } from '../src/presentation/sandboxServer.js';

const integrationEnabled = process.env['ENVOY_DNS_REBINDING_TEST'] === '1';
const hostname = process.env['ENVOY_DNS_REBINDING_HOST'] ?? '';
const dnsPort = Number(process.env['ENVOY_DNS_FIXTURE_HOST_PORT']);
const serviceToken = 'synthetic-dns-rebinding-service-token-0001';
let pool: PlaywrightContextPool | undefined;
let server: Awaited<ReturnType<typeof buildSandboxServer>> | undefined;
const originalValidateDestination = AntiSsrfGuard.validateDestination;

after(async () => {
  await server?.close();
  await pool?.close();
  AntiSsrfGuard.validateDestination = originalValidateDestination;
});

describe('DNS rebinding via isolated authoritative fixture and Envoy', () => {
  it('returns retryable failure for a private or unavailable DNS answer without verdict or capture', { skip: !integrationEnabled }, async () => {
    assert.match(hostname, /^rebind-[a-zA-Z0-9-]+\.fixture\.example$/);
    assert.ok(Number.isInteger(dnsPort) && dnsPort > 0, 'DNS fixture loopback port must be set');
    assert.ok(process.env['SANDBOX_EGRESS_PROXY_URL'], 'integration must configure the Envoy proxy');

    const resolver = new Resolver();
    resolver.setServers([`127.0.0.1:${dnsPort}`]);
    const resolveAll = async (queryHostname: string): Promise<Array<{ address: string; family: number }>> => {
      if (queryHostname.toLowerCase() !== hostname.toLowerCase()) throw new Error('Unexpected DNS fixture hostname.');
      const answers = await Promise.all([
        resolver.resolve4(queryHostname).then((addresses) => addresses.map((address) => ({ address, family: 4 }))),
        resolver.resolve6(queryHostname).then((addresses) => addresses.map((address) => ({ address, family: 6 }))).catch((error: unknown) => {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENODATA' || code === 'ENOTFOUND') return [];
          throw error;
        })
      ]);
      return answers.flat();
    };

    // RFC 5737 test-only answer is treated as a simulated public preflight result.
    // It is never contacted: Chromium must send the hostname to Envoy, whose next
    // A query receives the private synthetic canary address and is denied.
    AntiSsrfGuard.validateDestination = async (url: URL) => {
      const result = await originalValidateDestination.call(AntiSsrfGuard, url, resolveAll);
      if (url.hostname.toLowerCase() === hostname.toLowerCase() && result.resolvedIp === '192.0.2.10') {
        return { safe: true, resolvedIp: result.resolvedIp };
      }
      return result;
    };

    let captureWrites = 0;
    const storage: IScreenshotStorage = {
      async saveScreenshot(attemptId, _buffer) {
        captureWrites++;
        return `local://captures/${attemptId}.webp`;
      },
      async getScreenshot() { return null; }
    };
    pool = new PlaywrightContextPool(storage, 1, undefined, 1, 8_000);

    server = buildSandboxServer({ pool, storage, serviceToken });
    const response = await server.inject({
      method: 'POST',
      url: '/analyze',
      headers: { authorization: `Bearer ${serviceToken}` },
      payload: {
        attemptId: '88888888-8888-4888-8888-888888888888',
        url: `http://${hostname}/synthetic`
      }
    });
    assert.equal(response.statusCode, 502);
    assert.equal(response.headers['retry-after'], '1');
    assert.deepEqual(response.json(), {
      error: 'Bad Gateway',
      message: 'The destination could not be inspected.'
    });
    assert.equal(captureWrites, 0, 'DNS rebinding denial must not persist a capture');
  });
});
