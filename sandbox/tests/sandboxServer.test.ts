import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FastifyInstance } from 'fastify';
import { PlaywrightContextPool, SandboxAnalysisTimeoutError, SandboxCapacityError, SandboxNavigationError } from '../src/infrastructure/PlaywrightContextPool.js';
import { IScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';
import { buildSandboxServer } from '../src/presentation/sandboxServer.js';

const serviceToken = 'test_sandbox_service_token_32_bytes_long';
const attemptId = '11111111-1111-4111-8111-111111111111';
let server: FastifyInstance;
let analyzeCalls = 0;

after(async () => {
  await server?.close();
});

describe('Sandbox internal service authentication', () => {
  it('keeps health public and protects analysis and capture routes with a bearer token', async () => {
    const pool = {
      analyzeUrl: async (attemptId: string, url: string) => {
        analyzeCalls += 1;
        return { outcome: 'completed', attemptId, targetUrl: url, verdict: 'sin_amenazas_detectadas' };
      }
    } as unknown as PlaywrightContextPool;
    const storage = {
      getScreenshot: async () => Buffer.from('webp-test')
    } as unknown as IScreenshotStorage;

    server = buildSandboxServer({ pool, storage, serviceToken });
    await server.ready();

    const health = await server.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);

    const noToken = await server.inject({ method: 'POST', url: '/analyze', payload: { attemptId, url: 'https://example.com' } });
    assert.equal(noToken.statusCode, 401);
    assert.equal(analyzeCalls, 0);

    const wrongToken = await server.inject({
      method: 'POST', url: '/analyze',
      headers: { authorization: `Bearer ${'x'.repeat(Buffer.byteLength(serviceToken))}` },
      payload: { attemptId, url: 'https://example.com' }
    });
    assert.equal(wrongToken.statusCode, 401);
    assert.equal(wrongToken.body.includes(serviceToken), false);

    const allowed = await server.inject({
      method: 'POST', url: '/analyze',
      headers: { authorization: `Bearer ${serviceToken}` },
      payload: { attemptId, url: 'https://example.com' }
    });
    assert.equal(allowed.statusCode, 200);
    assert.equal(analyzeCalls, 1);

    const invalidAttempt = await server.inject({
      method: 'POST', url: '/analyze',
      headers: { authorization: `Bearer ${serviceToken}` },
      payload: { attemptId: '../escape', url: 'https://example.com' }
    });
    assert.equal(invalidAttempt.statusCode, 400);
    assert.equal(analyzeCalls, 1);

    const oversizedUrl = await server.inject({
      method: 'POST', url: '/analyze',
      headers: { authorization: `Bearer ${serviceToken}` },
      payload: { attemptId, url: `https://example.com/${'a'.repeat(65536)}` }
    });
    assert.equal(oversizedUrl.statusCode, 400);
    assert.equal(analyzeCalls, 1);

    const captureUnauthorized = await server.inject({ method: 'GET', url: `/captures/${attemptId}` });
    assert.equal(captureUnauthorized.statusCode, 401);
    const invalidCaptureId = await server.inject({
      method: 'GET', url: '/captures/not-a-uuid',
      headers: { authorization: `Bearer ${serviceToken}` }
    });
    assert.equal(invalidCaptureId.statusCode, 400);
    assert.equal(invalidCaptureId.headers['cache-control'], 'private, no-store');
    const captureAllowed = await server.inject({
      method: 'GET', url: `/captures/${attemptId}`,
      headers: { authorization: `Bearer ${serviceToken}` }
    });
    assert.equal(captureAllowed.statusCode, 200);
    assert.equal(captureAllowed.headers['content-type'], 'image/webp');
    assert.equal(captureAllowed.headers['cache-control'], 'private, no-store');
    assert.equal(captureAllowed.headers['x-content-type-options'], 'nosniff');
    assert.equal(captureAllowed.headers['access-control-allow-origin'], undefined);
  });

  it('rejects a missing or weak service token at construction', () => {
    const dependencies = {
      pool: {} as PlaywrightContextPool,
      storage: {} as IScreenshotStorage
    };
    assert.throws(() => buildSandboxServer({ ...dependencies, serviceToken: 'too-short' }), /at least 32 UTF-8 bytes/);
  });

  it('keeps submitted URL, credentials, page data, and raw browser errors out of responses and logs', async () => {
    const sensitiveUrl = 'https://private.example/path?token=url-query-canary';
    const sensitiveToken = 'sandbox-bearer-canary-that-is-over-thirty-two-bytes';
    const sensitivePageData = '<title>private-page-html-canary</title>';
    let capturedLogs = '';
    const errorServer = buildSandboxServer({
      pool: {
        analyzeUrl: async () => {
          throw new Error(`Navigation failed at ${sensitiveUrl}; ${sensitivePageData}; ${sensitiveToken}`);
        }
      } as unknown as PlaywrightContextPool,
      storage: { getScreenshot: async () => null } as unknown as IScreenshotStorage,
      serviceToken: sensitiveToken,
      loggerStream: { write(line: string) { capturedLogs += line; } }
    });

    try {
      await errorServer.ready();
      const response = await errorServer.inject({
        method: 'POST',
        url: '/analyze',
        headers: { authorization: `Bearer ${sensitiveToken}` },
        payload: { attemptId, url: sensitiveUrl }
      });

      assert.equal(response.statusCode, 500);
      assert.equal(response.body.includes(sensitiveUrl), false);
      assert.equal(response.body.includes('url-query-canary'), false);
      assert.equal(response.body.includes(sensitiveToken), false);
      assert.equal(response.body.includes(sensitivePageData), false);
      assert.equal(response.json().message, 'The analysis could not be completed.');
    } finally {
      await errorServer.close();
    }
    for (const canary of [sensitiveUrl, 'url-query-canary', sensitiveToken, sensitivePageData, 'Navigation failed']) {
      assert.equal(capturedLogs.includes(canary), false, `logs must not contain ${canary}`);
    }
  });

  it('returns a retryable 503 when the bounded browser queue is full', async () => {
    const capacityServer = buildSandboxServer({
      pool: { analyzeUrl: async () => { throw new SandboxCapacityError(); } } as unknown as PlaywrightContextPool,
      storage: { getScreenshot: async () => null } as unknown as IScreenshotStorage,
      serviceToken
    });
    try {
      await capacityServer.ready();
      const response = await capacityServer.inject({
        method: 'POST', url: '/analyze',
        headers: { authorization: `Bearer ${serviceToken}` },
        payload: { attemptId, url: 'https://example.com' }
      });
      assert.equal(response.statusCode, 503);
      assert.equal(response.headers['retry-after'], '1');
    } finally {
      await capacityServer.close();
    }
  });

  it('returns a generic retryable 504 when the sandbox analysis deadline expires', async () => {
    const timeoutServer = buildSandboxServer({
      pool: { analyzeUrl: async () => { throw new SandboxAnalysisTimeoutError(); } } as unknown as PlaywrightContextPool,
      storage: { getScreenshot: async () => null } as unknown as IScreenshotStorage,
      serviceToken
    });
    try {
      await timeoutServer.ready();
      const response = await timeoutServer.inject({
        method: 'POST', url: '/analyze',
        headers: { authorization: `Bearer ${serviceToken}` },
        payload: { attemptId, url: 'https://private.example/?token=synthetic-secret' }
      });
      assert.equal(response.statusCode, 504);
      assert.equal(response.headers['retry-after'], '1');
      assert.equal(response.body.includes('private.example'), false);
      assert.equal(response.body.includes('synthetic-secret'), false);
      assert.equal(response.json().message, 'The analysis exceeded its processing deadline.');
    } finally {
      await timeoutServer.close();
    }
  });

  it('returns a generic retryable 502 when the destination navigation fails', async () => {
    const navigationServer = buildSandboxServer({
      pool: { analyzeUrl: async () => { throw new SandboxNavigationError(); } } as unknown as PlaywrightContextPool,
      storage: { getScreenshot: async () => null } as unknown as IScreenshotStorage,
      serviceToken
    });
    try {
      await navigationServer.ready();
      const response = await navigationServer.inject({
        method: 'POST', url: '/analyze',
        headers: { authorization: `Bearer ${serviceToken}` },
        payload: { attemptId, url: 'https://private.example/?token=synthetic-secret' }
      });
      assert.equal(response.statusCode, 502);
      assert.equal(response.headers['retry-after'], '1');
      assert.equal(response.body.includes('private.example'), false);
      assert.equal(response.body.includes('synthetic-secret'), false);
    } finally {
      await navigationServer.close();
    }
  });
});
