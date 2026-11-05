import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import { registerAdminRoutes } from '../../../src/presentation/routes/adminRoutes.js';
import { errorHandler } from '../../../src/presentation/plugins/errorHandler.js';
import { TokenExpiredOrInvalidError, UnauthorizedAccessError } from '../../../src/core/errors/DomainErrors.js';
import { ListAuditEventsUseCase } from '../../../src/use-cases/admin/ListAuditEventsUseCase.js';
import { GetMetricsUseCase } from '../../../src/use-cases/admin/GetMetricsUseCase.js';
import { SecurityAuditEvent } from '../../../src/core/entities/SecurityAuditEvent.js';

let server: FastifyInstance;
let listInput: unknown;
let metricsInput: unknown;

function createServer(): FastifyInstance {
  server = Fastify({ logger: false });
  server.setErrorHandler(errorHandler);
  server.decorate('authenticate', async (request: FastifyRequest) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) throw new TokenExpiredOrInvalidError();
    const role = authorization.slice(7) === 'admin' ? 'admin' : 'usuario';
    request.user = { userId: '000000000000000000000001', email: 'test@example.com', role };
  });
  server.decorate('requireRole', (role: 'admin' | 'usuario') => async (request: FastifyRequest) => {
    if (request.user.role !== role) throw new UnauthorizedAccessError();
  });

  registerAdminRoutes(server, {
    listAuditEventsUseCase: {
      execute: async (input) => {
        listInput = input;
        return {
          items: [new SecurityAuditEvent({
            id: '000000000000000000000011',
            occurredAt: new Date('2026-11-03T12:00:00.000Z'),
            purgeAt: new Date('2027-02-01T00:00:00.000Z'),
            eventType: 'analysis.failed',
            metadata: { analysisStatus: 'failed' }
          })],
          hasMore: false,
          nextCursor: null
        };
      }
    } as unknown as ListAuditEventsUseCase,
    getMetricsUseCase: {
      execute: async (input) => {
        metricsInput = input;
        return {
          dateRange: { startDate: input.startDate, endDate: input.endDate },
          totalAttempts: 0,
          byStatus: { received: 0, validation_failed: 0, processing: 0, completed: 0, inconclusive: 0, failed: 0 },
          byVerdict: { peligroso: 0, sospechoso: 0, sin_amenazas_detectadas: 0 }
        };
      }
    } as unknown as GetMetricsUseCase
  });
  return server;
}

after(async () => { await server?.close(); });

describe('Admin routes contract validation', () => {
  it('requires an authenticated admin for both endpoints', async () => {
    const app = createServer();
    await app.ready();
    const anonymous = await app.inject({ method: 'GET', url: '/admin/metrics?startDate=2026-11-01&endDate=2026-11-03' });
    const user = await app.inject({ method: 'GET', url: '/admin/audit-events?startDate=2026-11-01&endDate=2026-11-03', headers: { authorization: 'Bearer user' } });

    assert.equal(anonymous.statusCode, 401);
    assert.equal(user.statusCode, 403);
  });

  it('rejects impossible and reversed metric date ranges', async () => {
    const app = createServer();
    await app.ready();
    const impossible = await app.inject({
      method: 'GET', url: '/admin/metrics?startDate=2026-02-30&endDate=2026-03-01',
      headers: { authorization: 'Bearer admin' }
    });
    const reversed = await app.inject({
      method: 'GET', url: '/admin/metrics?startDate=2026-11-03&endDate=2026-11-01',
      headers: { authorization: 'Bearer admin' }
    });

    assert.equal(impossible.statusCode, 400);
    assert.equal(reversed.statusCode, 400);
    assert.equal(metricsInput, undefined);
  });

  it('accepts a valid metric date range and passes it unchanged to the use case', async () => {
    const app = createServer();
    await app.ready();
    const response = await app.inject({
      method: 'GET', url: '/admin/metrics?startDate=2026-11-01&endDate=2026-11-03',
      headers: { authorization: 'Bearer admin' }
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(metricsInput, {
      requestingRole: 'admin',
      startDate: '2026-11-01',
      endDate: '2026-11-03'
    });
  });

  it('rejects invalid event type and out-of-contract pagination values', async () => {
    const app = createServer();
    await app.ready();
    const invalidType = await app.inject({
      method: 'GET', url: '/admin/audit-events?startDate=2026-11-01&endDate=2026-11-03&eventType=private.event',
      headers: { authorization: 'Bearer admin' }
    });
    const invalidLimit = await app.inject({
      method: 'GET', url: '/admin/audit-events?startDate=2026-11-01&endDate=2026-11-03&limit=101',
      headers: { authorization: 'Bearer admin' }
    });
    const unapprovedFilter = await app.inject({
      method: 'GET', url: '/admin/audit-events?startDate=2026-11-01&endDate=2026-11-03&actorId=user-1',
      headers: { authorization: 'Bearer admin' }
    });

    assert.equal(invalidType.statusCode, 400);
    assert.equal(invalidLimit.statusCode, 400);
    assert.equal(unapprovedFilter.statusCode, 400);
    assert.equal(listInput, undefined);
  });

  it('keeps valid pagination and serializes only the documented audit DTO fields', async () => {
    const app = createServer();
    await app.ready();
    const response = await app.inject({
      method: 'GET',
      url: '/admin/audit-events?startDate=2026-11-01&endDate=2026-11-03&eventType=analysis.failed&limit=5',
      headers: { authorization: 'Bearer admin' }
    });
    const body = response.json();

    assert.equal(response.statusCode, 200);
    assert.deepEqual(body.items[0], {
      id: '000000000000000000000011',
      occurredAt: '2026-11-03T12:00:00.000Z',
      eventType: 'analysis.failed',
      metadata: { analysisStatus: 'failed' }
    });
    assert.equal('purgeAt' in body.items[0], false);
    assert.equal(body.hasMore, false);
    assert.equal(body.nextCursor, null);
    assert.equal((listInput as { limit: number; eventType: string }).limit, 5);
    assert.equal((listInput as { eventType: string }).eventType, 'analysis.failed');
  });
});
