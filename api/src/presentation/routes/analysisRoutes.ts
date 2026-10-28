import { FastifyInstance } from 'fastify';
import { SubmitAnalysisUseCase } from '../../use-cases/analysis/SubmitAnalysisUseCase.js';
import { ListAnalysesUseCase } from '../../use-cases/analysis/ListAnalysesUseCase.js';
import { GetAnalysisDetailUseCase } from '../../use-cases/analysis/GetAnalysisDetailUseCase.js';
import { ProcessAnalysisJobUseCase } from '../../use-cases/analysis/ProcessAnalysisJobUseCase.js';

export interface AnalysisRoutesDependencies {
  submitAnalysisUseCase: SubmitAnalysisUseCase;
  listAnalysesUseCase: ListAnalysesUseCase;
  getAnalysisDetailUseCase: GetAnalysisDetailUseCase;
  processAnalysisJobUseCase?: ProcessAnalysisJobUseCase;
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

      // Dispatch async background analysis job if processor is configured
      if (deps.processAnalysisJobUseCase) {
        setImmediate(() => {
          deps.processAnalysisJobUseCase
            ?.execute({
              userId: request.user.userId,
              localDate: result.localDate,
              attemptId: result.attemptId,
              targetUrl: input ?? ''
            })
            .catch((err) => {
              request.log.error(err, 'Async analysis dispatch error');
            });
        });
      }

      return reply.status(201).send(result);
    }
  );

  // GET /analyses
  fastify.get<{
    Querystring: {
      limit?: string;
      cursor?: string;
      startDate?: string;
      endDate?: string;
    };
  }>(
    '/analyses',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 10;
      const result = await deps.listAnalysesUseCase.execute({
        userId: request.user.userId,
        limit,
        cursor: request.query.cursor,
        startDate: request.query.startDate,
        endDate: request.query.endDate
      });
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
}
