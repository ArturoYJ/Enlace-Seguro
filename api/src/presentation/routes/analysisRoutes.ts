import { FastifyInstance } from 'fastify';
import { SubmitAnalysisUseCase } from '../../use-cases/analysis/SubmitAnalysisUseCase.js';
import { ListAnalysesUseCase } from '../../use-cases/analysis/ListAnalysesUseCase.js';
import { GetAnalysisDetailUseCase } from '../../use-cases/analysis/GetAnalysisDetailUseCase.js';
import { GetAnalysisCaptureUseCase } from '../../use-cases/analysis/GetAnalysisCaptureUseCase.js';
import { GetAnalysisSummaryUseCase } from '../../use-cases/analysis/GetAnalysisSummaryUseCase.js';
import { ResourceNotFoundError, ValidationError } from '../../core/errors/DomainErrors.js';

export interface AnalysisRoutesDependencies {
  submitAnalysisUseCase: SubmitAnalysisUseCase;
  listAnalysesUseCase: ListAnalysesUseCase;
  getAnalysisSummaryUseCase: GetAnalysisSummaryUseCase;
  getAnalysisDetailUseCase: GetAnalysisDetailUseCase;
  getAnalysisCaptureUseCase?: GetAnalysisCaptureUseCase;
  captureProxyEnabled?: boolean;
}

export function registerAnalysisRoutes(fastify: FastifyInstance, deps: AnalysisRoutesDependencies): void {
  // POST /analyses
  fastify.post<{ Body: { input?: string } }>(
    '/analyses',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { input } = request.body || {};
      const result = await deps.submitAnalysisUseCase.execute({
        userId: request.user.userId,
        input: input ?? '',
        requestId: request.id
      });

      return reply.status(201).send(result);
    }
  );

  // GET /analyses
  fastify.get<{
    Querystring: {
      limit?: number;
      cursor?: string;
      startDate?: string;
      endDate?: string;
    };
  }>(
    '/analyses',
    {
      preHandler: [fastify.authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
            cursor: { type: 'string', maxLength: 256 },
            startDate: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
            endDate: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }
          }
        }
      }
    },
    async (request, reply) => {
      const { limit, cursor, startDate, endDate } = request.query;
      const result = await deps.listAnalysesUseCase.execute({
        userId: request.user.userId,
        limit: limit ?? 10,
        cursor,
        startDate,
        endDate
      });
      return reply.status(200).send(result);
    }
  );

  // GET /analyses/summary. Keep this static route before /analyses/:attemptId.
  fastify.get(
    '/analyses/summary',
    {
      onRequest: async (_request, reply) => {
        reply.header('Cache-Control', 'private, no-store');
      },
      preHandler: [fastify.authenticate],
      preValidation: async (request) => {
        if (Object.keys(request.query as Record<string, unknown>).length > 0) {
          throw new ValidationError('This endpoint does not accept query parameters.', [
            { name: 'query', reason: 'Remove all query parameters.' }
          ]);
        }
      },
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {}
        }
      }
    },
    async (request, reply) => {
      const result = await deps.getAnalysisSummaryUseCase.execute(request.user.userId);
      return reply.status(200).send(result);
    }
  );

  // GET /analyses/:attemptId
  fastify.get<{
    Params: { attemptId: string };
    Querystring: { localDate?: string };
  }>(
    '/analyses/:attemptId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { attemptId } = request.params;
      const { localDate } = request.query;

      const result = await deps.getAnalysisDetailUseCase.execute({
        attemptId,
        requestingUser: {
          userId: request.user.userId,
          role: request.user.role
        },
        localDate
      });
      return reply.status(200).send(result);
    }
  );

  // Private capture proxy. Disabled until the API-to-Sandbox private network is verified.
  fastify.get<{ Params: { attemptId: string } }>(
    '/analyses/:attemptId/capture',
    {
      onRequest: async (_request, reply) => {
        reply.header('Cache-Control', 'private, no-store');
        reply.header('X-Content-Type-Options', 'nosniff');
      },
      preHandler: [fastify.authenticate],
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['attemptId'],
          properties: { attemptId: { type: 'string', format: 'uuid' } }
        }
      }
    },
    async (request, reply) => {
      if (!deps.captureProxyEnabled || !deps.getAnalysisCaptureUseCase) {
        throw new ResourceNotFoundError('Analysis capture');
      }
      const image = await deps.getAnalysisCaptureUseCase.execute(request.user.userId, request.params.attemptId);
      return reply
        .type('image/webp')
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(Buffer.from(image));
    }
  );
}
