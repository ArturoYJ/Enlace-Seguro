import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { isAttemptId } from '../core/identifiers.js';
import { PlaywrightContextPool, SandboxAnalysisTimeoutError, SandboxCapacityError, SandboxNavigationError } from '../infrastructure/PlaywrightContextPool.js';
import { IScreenshotStorage } from '../infrastructure/ScreenshotStorage.js';

const MAX_TARGET_URL_BYTES = 64 * 1024;
const MAX_ANALYSIS_BODY_BYTES = 70 * 1024;

interface SandboxLogStream {
  write(line: string): void;
}

export interface SandboxServerOptions {
  pool: PlaywrightContextPool;
  storage: IScreenshotStorage;
  serviceToken: string;
  loggerStream?: SandboxLogStream;
}

export function buildSandboxServer(options: SandboxServerOptions): FastifyInstance {
  if (Buffer.byteLength(options.serviceToken, 'utf8') < 32 || /\s/.test(options.serviceToken)) {
    throw new Error('SANDBOX_SERVICE_TOKEN must contain at least 32 UTF-8 bytes and no whitespace.');
  }

  const server = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] || 'info',
      ...(options.loggerStream ? { stream: options.loggerStream } : {})
    }
  });

  const requireServiceToken = async (request: FastifyRequest, reply: FastifyReply) => {
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);
    const provided = match?.[1];

    if (!provided) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Service authentication required.' });
    }

    const expectedBytes = Buffer.from(options.serviceToken, 'utf8');
    const providedBytes = Buffer.from(provided, 'utf8');
    if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Service authentication required.' });
    }
  };

  server.get('/health', async (_request, reply) => {
    return reply.status(200).send({
      status: 'healthy',
      service: 'enlaceseguro-sandbox',
      timestamp: new Date().toISOString()
    });
  });

  server.post<{
    Body: {
      attemptId?: string;
      url?: string;
    };
  }>('/analyze', { preHandler: requireServiceToken, bodyLimit: MAX_ANALYSIS_BODY_BYTES }, async (request, reply) => {
    const { attemptId, url } = request.body || {};

    if (!isAttemptId(attemptId) || typeof url !== 'string' || url.trim().length === 0 || Buffer.byteLength(url, 'utf8') > MAX_TARGET_URL_BYTES) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'The analysis request is invalid.'
      });
    }

    try {
      const result = await options.pool.analyzeUrl(attemptId, url);
      return reply.status(200).send(result);
    } catch (error: unknown) {
      if (error instanceof SandboxCapacityError) {
        return reply.header('retry-after', '1').status(503).send({
          error: 'Service Unavailable',
          message: 'Sandbox capacity is temporarily exhausted.'
        });
      }
      if (error instanceof SandboxAnalysisTimeoutError) {
        return reply.header('retry-after', '1').status(504).send({
          error: 'Gateway Timeout',
          message: 'The analysis exceeded its processing deadline.'
        });
      }
      if (error instanceof SandboxNavigationError) {
        return reply.header('retry-after', '1').status(502).send({
          error: 'Bad Gateway',
          message: 'The destination could not be inspected.'
        });
      }
      // Browser errors may include the submitted URL or page-controlled data.
      // Keep the service response and logs free of those raw details.
      request.log.error({ attemptId }, 'Sandbox analysis failed');
      return reply.status(500).send({
        error: 'Sandbox Execution Error',
        message: 'The analysis could not be completed.'
      });
    }
  });

  server.get<{
    Params: { attemptId: string };
  }>('/captures/:attemptId', { preHandler: requireServiceToken }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff');
    const { attemptId } = request.params;
    if (!isAttemptId(attemptId)) {
      return reply.status(400).send({ error: 'Bad Request', message: 'The capture request is invalid.' });
    }
    const buffer = await options.storage.getScreenshot(attemptId);
    if (!buffer) {
      return reply.status(404).send({ error: 'Not Found', message: 'Screenshot not found.' });
    }
    return reply.header('content-type', 'image/webp').send(buffer);
  });

  return server;
}
