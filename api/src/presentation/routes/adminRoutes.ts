import { FastifyInstance } from 'fastify';
import { ListAuditEventsUseCase } from '../../use-cases/admin/ListAuditEventsUseCase.js';
import { GetMetricsUseCase } from '../../use-cases/admin/GetMetricsUseCase.js';
import { AuditEventType } from '../../core/entities/SecurityAuditEvent.js';

export interface AdminRoutesDependencies {
  listAuditEventsUseCase: ListAuditEventsUseCase;
  getMetricsUseCase: GetMetricsUseCase;
}

export function registerAdminRoutes(fastify: FastifyInstance, deps: AdminRoutesDependencies): void {
  // GET /admin/audit-events
  fastify.get<{
    Querystring: {
      startDate: string;
      endDate: string;
      eventType?: string;
      limit?: string;
      cursor?: string;
    };
  }>(
    '/admin/audit-events',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const { startDate, endDate, eventType, limit, cursor } = request.query;

      const result = await deps.listAuditEventsUseCase.execute({
        requestingRole: request.user.role,
        requestingUserId: request.user.userId,
        startDate,
        endDate,
        eventType: eventType as AuditEventType | undefined,
        limit: limit ? parseInt(limit, 10) : 20,
        cursor
      });

      return reply.status(200).send(result);
    }
  );

  // GET /admin/metrics
  fastify.get<{
    Querystring: {
      startDate: string;
      endDate: string;
    };
  }>(
    '/admin/metrics',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const { startDate, endDate } = request.query;

      const result = await deps.getMetricsUseCase.execute({
        requestingRole: request.user.role,
        startDate,
        endDate
      });

      return reply.status(200).send(result);
    }
  );
}
