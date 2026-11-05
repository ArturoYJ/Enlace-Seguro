import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import { registerAnalysisRoutes } from '../../../src/presentation/routes/analysisRoutes.js';
import { errorHandler } from '../../../src/presentation/plugins/errorHandler.js';
import { TokenExpiredOrInvalidError } from '../../../src/core/errors/DomainErrors.js';

let apps: FastifyInstance[] = [];
function createServer(enabled: boolean, getCapture: (userId: string, attemptId: string) => Promise<Uint8Array>): FastifyInstance {
  const app = Fastify({ logger: false });
  apps.push(app);
  app.setErrorHandler(errorHandler);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer valid') throw new TokenExpiredOrInvalidError();
    request.user = { userId: 'owner-1', email: 'owner@example.test', role: 'usuario' };
  });
  registerAnalysisRoutes(app, {
    submitAnalysisUseCase: {} as never,
    listAnalysesUseCase: {} as never,
    getAnalysisSummaryUseCase: {} as never,
    getAnalysisDetailUseCase: {} as never,
    getAnalysisCaptureUseCase: { execute: getCapture } as never,
    captureProxyEnabled: enabled
  });
  return app;
}

after(async () => { await Promise.all(apps.map((app) => app.close())); apps = []; });

describe('private analysis capture route', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';

  it('requires auth and is disabled by default without calling the capture use case', async () => {
    let calls = 0;
    const app = createServer(false, async () => { calls += 1; return new Uint8Array(); });
    const anon = await app.inject({ method: 'GET', url: `/analyses/${id}/capture` });
    const disabled = await app.inject({ method: 'GET', url: `/analyses/${id}/capture`, headers: { authorization: 'Bearer valid' } });
    assert.equal(anon.statusCode, 401);
    assert.equal(disabled.statusCode, 404);
    assert.equal(calls, 0);
  });

  it('returns private WebP bytes and cache/security headers when enabled', async () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
    let received: unknown;
    const app = createServer(true, async (userId, attemptId) => { received = { userId, attemptId }; return bytes; });
    const response = await app.inject({ method: 'GET', url: `/analyses/${id}/capture`, headers: { authorization: 'Bearer valid' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'image/webp');
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(response.rawPayload, Buffer.from(bytes));
    assert.deepEqual(received, { userId: 'owner-1', attemptId: id });
  });

  it('rejects malformed attempt IDs before calling the proxy', async () => {
    let calls = 0;
    const app = createServer(true, async () => { calls += 1; return new Uint8Array(); });
    const response = await app.inject({ method: 'GET', url: '/analyses/not-a-uuid/capture', headers: { authorization: 'Bearer valid' } });
    assert.equal(response.statusCode, 400);
    assert.equal(calls, 0);
  });
});
