import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { RegisterUserUseCase } from '../../use-cases/auth/RegisterUserUseCase.js';
import { LoginUserUseCase } from '../../use-cases/auth/LoginUserUseCase.js';
import { RefreshTokenUseCase } from '../../use-cases/auth/RefreshTokenUseCase.js';
import { LogoutUserUseCase } from '../../use-cases/auth/LogoutUserUseCase.js';
import { GetCurrentUserUseCase } from '../../use-cases/auth/GetCurrentUserUseCase.js';

export interface AuthRoutesDependencies {
  registerUserUseCase: RegisterUserUseCase;
  loginUserUseCase: LoginUserUseCase;
  refreshTokenUseCase: RefreshTokenUseCase;
  logoutUserUseCase: LogoutUserUseCase;
  getCurrentUserUseCase: GetCurrentUserUseCase;
}

export function registerAuthRoutes(fastify: FastifyInstance, deps: AuthRoutesDependencies): void {
  // POST /auth/register
  fastify.post('/auth/register', async (request: FastifyRequest<{ Body: { email?: string; password?: string } }>, reply: FastifyReply) => {
    const { email, password } = request.body || {};
    const result = await deps.registerUserUseCase.execute({
      email: email ?? '',
      password: password ?? '',
      requestId: request.id
    });
    return reply.status(201).send(result);
  });

  // POST /auth/login
  fastify.post('/auth/login', async (request: FastifyRequest<{ Body: { email?: string; password?: string } }>, reply: FastifyReply) => {
    const { email, password } = request.body || {};
    const result = await deps.loginUserUseCase.execute({
      email: email ?? '',
      password: password ?? '',
      requestId: request.id
    });
    return reply.status(200).send(result);
  });

  // POST /auth/refresh
  fastify.post('/auth/refresh', async (request: FastifyRequest<{ Body: { refreshToken?: string } }>, reply: FastifyReply) => {
    const { refreshToken } = request.body || {};
    const result = await deps.refreshTokenUseCase.execute({
      refreshToken: refreshToken ?? '',
      requestId: request.id
    });
    return reply.status(200).send(result);
  });

  // POST /auth/logout
  fastify.post('/auth/logout', async (request: FastifyRequest<{ Body: { refreshToken?: string; allDevices?: boolean } }>, reply: FastifyReply) => {
    const { refreshToken, allDevices } = request.body || {};
    await deps.logoutUserUseCase.execute({
      refreshToken: refreshToken ?? '',
      allDevices: allDevices ?? false,
      userId: request.user?.userId
    });
    return reply.status(204).send();
  });

  // GET /auth/me
  fastify.get('/auth/me', { preHandler: [fastify.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await deps.getCurrentUserUseCase.execute(request.user.userId);
    return reply.status(200).send(result);
  });
}
