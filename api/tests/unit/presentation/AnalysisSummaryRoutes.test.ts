import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import { registerAnalysisRoutes } from '../../../src/presentation/routes/analysisRoutes.js';
import { errorHandler } from '../../../src/presentation/plugins/errorHandler.js';
import { TokenExpiredOrInvalidError } from '../../../src/core/errors/DomainErrors.js';

const apps: FastifyInstance[] = [];

function createServer(): { app: FastifyInstance; owners: string[] } {
  const app = Fastify({ logger: false });
  apps.push(app);
  const owners: string[] = [];
  app.setErrorHandler(errorHandler);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer valid') throw new TokenExpiredOrInvalidError();
    request.user = { userId: '507f1f77bcf86cd799439011', email: 'owner@example.test', role: 'usuario' };
  });
  registerAnalysisRoutes(app, {
    submitAnalysisUseCase: {} as never,
    listAnalysesUseCase: {} as never,
    getAnalysisSummaryUseCase: {
      async execute(userId: string) {
        owners.push(userId);
        return {
          window: { startsAtInclusive: '2025-11-05T12:00:00.000Z', endsAtExclusive: '2026-11-04T12:00:00.000Z' },
          total: 4,
          dangerous: 1,
          suspicious: 2
        };
      }
    } as never,
    getAnalysisDetailUseCase: {} as never
  });
  return { app, owners };
}

after(async () => { await Promise.all(apps.map((app) => app.close())); });

describe('personal analysis summary route', () => {
  it('requires authentication and rejects caller-selected owner filters', async () => {
    const { app, owners } = createServer();
    const anonymous = await app.inject({ method: 'GET', url: '/analyses/summary' });
    const override = await app.inject({ method: 'GET', url: '/analyses/summary?userId=507f1f77bcf86cd799439012', headers: { authorization: 'Bearer valid' } });
    assert.equal(anonymous.statusCode, 401);
    assert.equal(override.statusCode, 400);
    assert.deepEqual(owners, []);
  });

  it('derives owner from auth, returns only counts and exact window, and disables caching', async () => {
    const { app, owners } = createServer();
    const response = await app.inject({ method: 'GET', url: '/analyses/summary', headers: { authorization: 'Bearer valid' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.deepEqual(owners, ['507f1f77bcf86cd799439011']);
    assert.deepEqual(response.json(), {
      window: { startsAtInclusive: '2025-11-05T12:00:00.000Z', endsAtExclusive: '2026-11-04T12:00:00.000Z' },
      total: 4,
      dangerous: 1,
      suspicious: 2
    });
    assert.doesNotMatch(response.body, /owner@example|submittedInput|attemptId|url|digest/i);
  });
});
