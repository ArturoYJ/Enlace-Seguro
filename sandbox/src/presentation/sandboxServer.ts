import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { PlaywrightContextPool } from '../infrastructure/PlaywrightContextPool.js';
import { IScreenshotStorage } from '../infrastructure/ScreenshotStorage.js';

export interface SandboxServerOptions {
  pool: PlaywrightContextPool;
  storage: IScreenshotStorage;
}

export function buildSandboxServer(options: SandboxServerOptions): FastifyInstance {
  const server = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] || 'info'
    }
  });

  server.register(cors, { origin: true });

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
  }>('/analyze', async (request, reply) => {
    const { attemptId, url } = request.body || {};

    if (!attemptId || !url) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Both attemptId and url are required fields.'
      });
    }

    try {
      const result = await options.pool.analyzeUrl(attemptId, url);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown sandbox failure';
      request.log.error(err, 'Sandbox analysis error');
      return reply.status(500).send({
        error: 'Sandbox Execution Error',
        message
      });
    }
  });

  server.get<{
    Params: { attemptId: string };
  }>('/captures/:attemptId', async (request, reply) => {
    const { attemptId } = request.params;
    const buffer = await options.storage.getScreenshot(attemptId);
    if (!buffer) {
      return reply.status(404).send({ error: 'Not Found', message: 'Screenshot not found.' });
    }
    return reply.header('content-type', 'image/webp').send(buffer);
  });

  return server;
}
