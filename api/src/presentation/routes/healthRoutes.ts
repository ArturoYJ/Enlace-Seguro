import { FastifyInstance } from 'fastify';
import { MongoDbConnection } from '../../infrastructure/database/mongo/MongoDbConnection.js';
import { ISandboxService } from '../../core/ports/ISandboxService.js';

export function registerHealthRoutes(
  fastify: FastifyInstance,
  mongoConn: MongoDbConnection,
  sandboxService?: ISandboxService
): void {
  fastify.get('/health', async (_request, reply) => {
    const isDbConnected = await mongoConn.ping();
    const isSandboxConnected = sandboxService ? await sandboxService.isHealthy() : true;
    const isHealthy = isDbConnected && isSandboxConnected;

    const response = {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: isDbConnected ? 'up' : 'down',
        sandboxPool: isSandboxConnected ? 'up' : 'down'
      }
    };

    return reply.status(isHealthy ? 200 : 503).send(response);
  });
}
