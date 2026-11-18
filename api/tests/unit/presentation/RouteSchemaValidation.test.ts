import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../../../src/presentation/server.js';
import { RegisterUserUseCase } from '../../../src/use-cases/auth/RegisterUserUseCase.js';
import { LoginUserUseCase } from '../../../src/use-cases/auth/LoginUserUseCase.js';
import { RefreshTokenUseCase } from '../../../src/use-cases/auth/RefreshTokenUseCase.js';
import { LogoutUserUseCase } from '../../../src/use-cases/auth/LogoutUserUseCase.js';
import { GetCurrentUserUseCase } from '../../../src/use-cases/auth/GetCurrentUserUseCase.js';
import { SubmitAnalysisUseCase } from '../../../src/use-cases/analysis/SubmitAnalysisUseCase.js';
import { GetAnalysisDetailUseCase } from '../../../src/use-cases/analysis/GetAnalysisDetailUseCase.js';
import { JwtTokenService } from '../../../src/infrastructure/security/JwtTokenService.js';
import { BcryptPasswordHasher } from '../../../src/infrastructure/security/BcryptPasswordHasher.js';
import {
  MockUserRepository,
  MockRefreshTokenRepository,
  MockSecurityAuditRepository,
  MockDailyAnalysisRepository,
  MockLoginRateLimiter
} from '../../mocks/MockRepositories.js';

// Regresión de la consulta CodeQL enlaceseguro/fastify-ruta-sin-schema:
// un valor JSON con tipo incorrecto debe rechazarse con 400 antes de llegar al caso de uso.
function testServer() {
  const userRepo = new MockUserRepository();
  const tokenRepo = new MockRefreshTokenRepository();
  const auditRepo = new MockSecurityAuditRepository();
  const dailyRepo = new MockDailyAnalysisRepository();
  const hasher = new BcryptPasswordHasher(4);
  const tokenService = new JwtTokenService('test_secret_32_characters_minimum_length_required!', 900);
  const rateLimiter = new MockLoginRateLimiter();

  const server = buildServer({
    mongoConnection: { ping: async () => true } as never,
    tokenService,
    authDeps: {
      registerUserUseCase: new RegisterUserUseCase(userRepo, auditRepo, hasher),
      loginUserUseCase: new LoginUserUseCase(userRepo, tokenRepo, auditRepo, hasher, tokenService, rateLimiter),
      refreshTokenUseCase: new RefreshTokenUseCase(userRepo, tokenRepo, auditRepo, tokenService),
      logoutUserUseCase: new LogoutUserUseCase(tokenRepo, tokenService),
      getCurrentUserUseCase: new GetCurrentUserUseCase(userRepo, dailyRepo)
    },
    analysisDeps: {
      submitAnalysisUseCase: new SubmitAnalysisUseCase(dailyRepo, auditRepo),
      getAnalysisDetailUseCase: new GetAnalysisDetailUseCase(dailyRepo)
    } as never,
    adminDeps: {} as never,
    environment: 'development'
  });
  const accessToken = tokenService.generateAccessToken({
    userId: '507f1f77bcf86cd799439011',
    email: 'user@example.com',
    role: 'usuario'
  });
  return { server, accessToken };
}

const casos: Array<{ nombre: string; method: 'POST' | 'GET'; url: string; payload?: unknown; auth?: boolean }> = [
  { nombre: 'register con email objeto', method: 'POST', url: '/api/v1/auth/register', payload: { email: { $ne: null }, password: 'SecretPassword123!' } },
  { nombre: 'register con password arreglo', method: 'POST', url: '/api/v1/auth/register', payload: { email: 'a@example.com', password: ['1', '2', '3', '4', '5', '6', '7', '8'] } },
  { nombre: 'login con email objeto', method: 'POST', url: '/api/v1/auth/login', payload: { email: { $gt: '' }, password: 'x' } },
  { nombre: 'refresh con token objeto', method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: { $ne: null } } },
  { nombre: 'logout con token objeto', method: 'POST', url: '/api/v1/auth/logout', payload: { refreshToken: { $ne: null } } },
  { nombre: 'analyses con input arreglo', method: 'POST', url: '/api/v1/analyses', payload: { input: ['https://example.com', 'https://b.example'] }, auth: true },
  { nombre: 'detalle con localDate repetido', method: 'GET', url: '/api/v1/analyses/0d8a3c7e-1b2f-4c3d-8e9f-0a1b2c3d4e5f?localDate=2026-11-01&localDate=2026-11-02', auth: true }
];

describe('validación de esquema en rutas Fastify', () => {
  for (const caso of casos) {
    it(`${caso.nombre} responde 400`, async () => {
      const { server, accessToken } = testServer();
      try {
        const response = await server.inject({
          method: caso.method,
          url: caso.url,
          ...(caso.payload !== undefined ? { payload: caso.payload as object } : {}),
          headers: caso.auth ? { authorization: `Bearer ${accessToken}` } : {}
        });
        assert.equal(response.statusCode, 400, `${caso.nombre}: ${response.statusCode} ${response.body}`);
      } finally {
        await server.close();
      }
    });
  }
});
