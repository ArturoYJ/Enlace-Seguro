import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { ITokenService } from '../../core/ports/ISecurityServices.js';
import { TokenExpiredOrInvalidError, UnauthorizedAccessError } from '../../core/errors/DomainErrors.js';
import { UserRole } from '../../core/entities/User.js';

export interface AuthenticatedUserPayload {
  userId: string;
  email: string;
  role: UserRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUserPayload;
  }
}

export interface AuthPluginOptions {
  tokenService: ITokenService;
}

export const authPlugin = fp(async (fastify: FastifyInstance, options: AuthPluginOptions) => {
  fastify.decorateRequest('user', null as unknown as AuthenticatedUserPayload);

  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new TokenExpiredOrInvalidError('Authorization header with Bearer scheme is required.');
      }

      const token = authHeader.substring(7).trim();
      const decoded = options.tokenService.verifyAccessToken(token);

      request.user = {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role
      };
    }
  );

  fastify.decorate(
    'requireRole',
    (requiredRole: UserRole) => {
      return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
        if (!request.user) {
          throw new TokenExpiredOrInvalidError('Authentication is required before authorization check.');
        }

        if (request.user.role !== requiredRole) {
          throw new UnauthorizedAccessError(`Operation requires '${requiredRole}' role.`);
        }
      };
    }
  );
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (role: UserRole) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
