import { FastifyInstance, FastifyRequest } from 'fastify';
import { ListAuditEventsUseCase } from '../../use-cases/admin/ListAuditEventsUseCase.js';
import { GetMetricsUseCase } from '../../use-cases/admin/GetMetricsUseCase.js';
import { AUDIT_EVENT_TYPES, AuditEventType, SecurityAuditEvent } from '../../core/entities/SecurityAuditEvent.js';
import { ValidationError } from '../../core/errors/DomainErrors.js';

const DATE_ONLY_SCHEMA = { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' } as const;

function parseDateOnly(value: string): Date | null {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function assertDateRange(startDate: string, endDate: string): void {
  const invalidParams: Array<{ name: string; reason: string }> = [];
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start) invalidParams.push({ name: 'startDate', reason: 'Must be a real calendar date in YYYY-MM-DD format.' });
  if (!end) invalidParams.push({ name: 'endDate', reason: 'Must be a real calendar date in YYYY-MM-DD format.' });
  if (start && end && start > end) {
    invalidParams.push({ name: 'endDate', reason: 'Must be on or after startDate.' });
  }
  if (invalidParams.length > 0) {
    throw new ValidationError('The requested date range is invalid.', invalidParams);
  }
}

function rejectUnknownQueryKeys(allowed: readonly string[]) {
  return async (request: FastifyRequest): Promise<void> => {
    const query = request.query as Record<string, unknown>;
    const unknown = Object.keys(query).find((key) => !allowed.includes(key));
    if (unknown) {
      throw new ValidationError('The query contains an unsupported parameter.', [
        { name: unknown, reason: 'This parameter is not supported.' }
      ]);
    }
  };
}

function toAuditEventDto(event: SecurityAuditEvent) {
  return {
    id: event.id,
    occurredAt: event.occurredAt,
    eventType: event.eventType,
    ...(event.actorType !== undefined && { actorType: event.actorType }),
    ...(event.actorId !== undefined && { actorId: event.actorId }),
    ...(event.action !== undefined && { action: event.action }),
    ...(event.outcome !== undefined && { outcome: event.outcome }),
    ...(event.resourceType !== undefined && { resourceType: event.resourceType }),
    ...(event.resourceId !== undefined && { resourceId: event.resourceId }),
    ...(event.requestId !== undefined && { requestId: event.requestId }),
    ...(event.metadata !== undefined && { metadata: event.metadata })
  };
}

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
      limit?: number;
      cursor?: string;
    };
  }>(
    '/admin/audit-events',
    {
      preValidation: rejectUnknownQueryKeys(['startDate', 'endDate', 'eventType', 'limit', 'cursor']),
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
      schema: {
        querystring: {
          type: 'object',
          required: ['startDate', 'endDate'],
          additionalProperties: false,
          properties: {
            startDate: DATE_ONLY_SCHEMA,
            endDate: DATE_ONLY_SCHEMA,
            eventType: { type: 'string', enum: [...AUDIT_EVENT_TYPES] },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            cursor: { type: 'string', maxLength: 128 }
          }
        }
      }
    },
    async (request, reply) => {
      const { startDate, endDate, eventType, limit, cursor } = request.query;
      assertDateRange(startDate, endDate);

      const result = await deps.listAuditEventsUseCase.execute({
        requestingRole: request.user.role,
        requestingUserId: request.user.userId,
        startDate,
        endDate,
        eventType: eventType as AuditEventType | undefined,
        limit: limit ?? 20,
        cursor
      });

      return reply.status(200).send({ ...result, items: result.items.map(toAuditEventDto) });
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
    {
      preValidation: rejectUnknownQueryKeys(['startDate', 'endDate']),
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
      schema: {
        querystring: {
          type: 'object',
          required: ['startDate', 'endDate'],
          additionalProperties: false,
          properties: {
            startDate: DATE_ONLY_SCHEMA,
            endDate: DATE_ONLY_SCHEMA
          }
        }
      }
    },
    async (request, reply) => {
      const { startDate, endDate } = request.query;
      assertDateRange(startDate, endDate);

      const result = await deps.getMetricsUseCase.execute({
        requestingRole: request.user.role,
        startDate,
        endDate
      });

      return reply.status(200).send(result);
    }
  );
}
