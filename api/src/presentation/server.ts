import Fastify, { LogController, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { errorHandler, requestPathWithoutQuery } from './plugins/errorHandler.js';
import { authPlugin } from './plugins/authPlugin.js';
import { registerHealthRoutes } from './routes/healthRoutes.js';
import { registerAuthRoutes, AuthRoutesDependencies } from './routes/authRoutes.js';
import { registerAnalysisRoutes, AnalysisRoutesDependencies } from './routes/analysisRoutes.js';
import { registerAdminRoutes, AdminRoutesDependencies } from './routes/adminRoutes.js';
import { ITokenService } from '../core/ports/ISecurityServices.js';
import { ISandboxService } from '../core/ports/ISandboxService.js';
import { MongoDbConnection } from '../infrastructure/database/mongo/MongoDbConnection.js';
import { parseCorsAllowedOrigins } from './config/corsPolicy.js';

export interface ServerDependencies {
  mongoConnection: MongoDbConnection;
  tokenService: ITokenService;
  sandboxService?: ISandboxService;
  authDeps: AuthRoutesDependencies;
  analysisDeps: AnalysisRoutesDependencies;
  adminDeps: AdminRoutesDependencies;
  loggerStream?: { write(message: string): void };
  corsAllowedOrigins?: string;
  environment?: string;
}

export function buildServer(deps: ServerDependencies): FastifyInstance {
  const allowedOrigins = parseCorsAllowedOrigins(
    deps.corsAllowedOrigins ?? process.env['CORS_ALLOWED_ORIGINS'] ?? '',
    (deps.environment ?? process.env['NODE_ENV']) === 'production'
  );
  const trustedProxyCidrs = (process.env['TRUST_PROXY_CIDRS'] ?? '')
    .split(',')
    .map((cidr) => cidr.trim())
    .filter(Boolean);
  const server = Fastify({
    trustProxy: trustedProxyCidrs.length > 0 ? trustedProxyCidrs : false,
    logger: {
      level: process.env['LOG_LEVEL'] || 'info',
      ...(deps.loggerStream ? { stream: deps.loggerStream } : {}),
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: requestPathWithoutQuery(req.url),
            hostname: req.hostname
          };
        }
      }
    },
    logController: new LogController({ disableRequestLogging: false })
  });

  server.setErrorHandler(errorHandler);

  server.register(sensible);
  server.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type']
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
