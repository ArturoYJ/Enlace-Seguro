import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { errorHandler } from './plugins/errorHandler.js';
import { authPlugin } from './plugins/authPlugin.js';
import { registerHealthRoutes } from './routes/healthRoutes.js';
import { registerAuthRoutes, AuthRoutesDependencies } from './routes/authRoutes.js';
import { registerAnalysisRoutes, AnalysisRoutesDependencies } from './routes/analysisRoutes.js';
import { registerAdminRoutes, AdminRoutesDependencies } from './routes/adminRoutes.js';
import { ITokenService } from '../core/ports/ISecurityServices.js';
import { ISandboxService } from '../core/ports/ISandboxService.js';
import { MongoDbConnection } from '../infrastructure/database/mongo/MongoDbConnection.js';

export interface ServerDependencies {
  mongoConnection: MongoDbConnection;
  tokenService: ITokenService;
  sandboxService?: ISandboxService;
  authDeps: AuthRoutesDependencies;
  analysisDeps: AnalysisRoutesDependencies;
  adminDeps: AdminRoutesDependencies;
}

export function buildServer(deps: ServerDependencies): FastifyInstance {
  const server = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] || 'info',
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url,
            hostname: req.hostname,
            remoteAddress: req.ip
          };
        }
      }
    },
    disableRequestLogging: false
  });

  server.setErrorHandler(errorHandler);

  server.register(sensible);
  server.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  server.register(authPlugin, {
    tokenService: deps.tokenService
  });

  // Prefix routes under /api/v1
  server.register(
    async (v1) => {
      registerHealthRoutes(v1, deps.mongoConnection, deps.sandboxService);
      registerAuthRoutes(v1, deps.authDeps);
      registerAnalysisRoutes(v1, deps.analysisDeps);
      registerAdminRoutes(v1, deps.adminDeps);
    },
    { prefix: '/api/v1' }
  );

  return server;
}
