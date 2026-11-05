import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../../../src/presentation/server.js';
import { parseCorsAllowedOrigins } from '../../../src/presentation/config/corsPolicy.js';

function testServer(corsAllowedOrigins: string) {
  return buildServer({
    mongoConnection: { ping: async () => true } as never,
    tokenService: {} as never,
    authDeps: {} as never,
    analysisDeps: {} as never,
    adminDeps: {} as never,
    corsAllowedOrigins,
    environment: 'development'
  });
}

describe('browser CORS policy', () => {
  it('does not reflect arbitrary origins or allow credentialed access by default', async () => {
    const server = testServer('');
    try {
      const response = await server.inject({
        method: 'GET', url: '/api/v1/health', headers: { origin: 'https://untrusted.example' }
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['access-control-allow-origin'], undefined);
      assert.equal(response.headers['access-control-allow-credentials'], undefined);
    } finally {
      await server.close();
    }
  });

  it('allows only a configured exact admin origin and its authorization preflight', async () => {
    const origin = 'https://console.example.test';
    const server = testServer(origin);
    try {
      const allowed = await server.inject({
        method: 'GET', url: '/api/v1/health', headers: { origin }
      });
      assert.equal(allowed.headers['access-control-allow-origin'], origin);
      assert.equal(allowed.headers['access-control-allow-credentials'], undefined);

      const denied = await server.inject({
        method: 'GET', url: '/api/v1/health', headers: { origin: 'https://evil.example' }
      });
      assert.equal(denied.headers['access-control-allow-origin'], undefined);

      const preflight = await server.inject({
        method: 'OPTIONS', url: '/api/v1/admin/metrics',
        headers: {
          origin,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization'
        }
      });
      assert.equal(preflight.statusCode, 204);
      assert.equal(preflight.headers['access-control-allow-origin'], origin);
      assert.match(String(preflight.headers['access-control-allow-headers']), /Authorization/i);
    } finally {
      await server.close();
    }
  });

  it('rejects wildcard, paths, HTTP in production, and non-loopback HTTP', () => {
    for (const raw of ['*', 'null', 'https://console.example.test/path', 'https://console.example.test/',
      'http://console.example.test', 'https://user:pass@console.example.test']) {
      assert.throws(() => parseCorsAllowedOrigins(raw, true));
    }
    assert.deepEqual(parseCorsAllowedOrigins('http://localhost:5173,http://localhost:5173', false), ['http://localhost:5173']);
  });
});
