import 'dotenv/config';
import { MongoDbConnection } from './infrastructure/database/mongo/MongoDbConnection.js';
import { MongoUserRepository } from './infrastructure/database/mongo/MongoUserRepository.js';
import { MongoRefreshTokenRepository } from './infrastructure/database/mongo/MongoRefreshTokenRepository.js';
import { MongoDailyAnalysisRepository } from './infrastructure/database/mongo/MongoDailyAnalysisRepository.js';
import { MongoSecurityAuditRepository } from './infrastructure/database/mongo/MongoSecurityAuditRepository.js';
import { BcryptPasswordHasher } from './infrastructure/security/BcryptPasswordHasher.js';
import { JwtTokenService } from './infrastructure/security/JwtTokenService.js';
import { HttpSandboxService } from './infrastructure/sandbox/HttpSandboxService.js';
import { RegisterUserUseCase } from './use-cases/auth/RegisterUserUseCase.js';
import { LoginUserUseCase } from './use-cases/auth/LoginUserUseCase.js';
import { RefreshTokenUseCase } from './use-cases/auth/RefreshTokenUseCase.js';
import { LogoutUserUseCase } from './use-cases/auth/LogoutUserUseCase.js';
import { GetCurrentUserUseCase } from './use-cases/auth/GetCurrentUserUseCase.js';
import { SubmitAnalysisUseCase } from './use-cases/analysis/SubmitAnalysisUseCase.js';
import { ListAnalysesUseCase } from './use-cases/analysis/ListAnalysesUseCase.js';
import { GetAnalysisDetailUseCase } from './use-cases/analysis/GetAnalysisDetailUseCase.js';
import { ProcessAnalysisJobUseCase } from './use-cases/analysis/ProcessAnalysisJobUseCase.js';
import { ListAuditEventsUseCase } from './use-cases/admin/ListAuditEventsUseCase.js';
import { GetMetricsUseCase } from './use-cases/admin/GetMetricsUseCase.js';
import { buildServer } from './presentation/server.js';

async function bootstrap() {
  const port = parseInt(process.env['PORT'] || '3000', 10);
  const host = process.env['HOST'] || '0.0.0.0';
  const mongoUri = process.env['MONGODB_URI'] || 'mongodb://localhost:27017';
  const dbName = process.env['MONGODB_DB_NAME'] || 'enlaceseguro_dev';
  const sandboxUrl = process.env['SANDBOX_SERVICE_URL'] || 'http://localhost:3001';
  const jwtSecret = process.env['JWT_SECRET'] || 'development_jwt_secret_must_be_at_least_32_characters_long!';
  const jwtExpiresIn = parseInt(process.env['JWT_EXPIRES_IN_SECONDS'] || '900', 10);
  const refreshTokenExpiresInDays = parseInt(process.env['REFRESH_TOKEN_EXPIRES_IN_DAYS'] || '7', 10);
  const timezone = process.env['TIMEZONE'] || 'America/Mexico_City';
  const dailyQuota = parseInt(process.env['DAILY_ANALYSIS_QUOTA'] || '5', 10);

  // 1. Infrastructure Adapters
  const mongoConnection = new MongoDbConnection(mongoUri, dbName);
  let db;
  try {
    db = await mongoConnection.connect();
    console.log(`[INFO] Connected to MongoDB database: ${dbName}`);
  } catch (err) {
    console.warn(`[WARN] MongoDB connection failed on startup (${mongoUri}). Running in offline/degraded mode until database is available.`);
  }

  // Fallback db dummy if not connected initially
  const activeDb = db ?? mongoConnection.getDatabase();

  const userRepository = new MongoUserRepository(activeDb);
  const refreshTokenRepository = new MongoRefreshTokenRepository(activeDb);
  const dailyAnalysisRepository = new MongoDailyAnalysisRepository(activeDb);
  const securityAuditRepository = new MongoSecurityAuditRepository(activeDb);

  const passwordHasher = new BcryptPasswordHasher(12);
  const tokenService = new JwtTokenService(jwtSecret, jwtExpiresIn);
  const sandboxService = new HttpSandboxService(sandboxUrl);

  // 2. Use Cases Orchestration
  const registerUserUseCase = new RegisterUserUseCase(userRepository, securityAuditRepository, passwordHasher);
  const loginUserUseCase = new LoginUserUseCase(
    userRepository,
    refreshTokenRepository,
    securityAuditRepository,
    passwordHasher,
    tokenService,
    jwtExpiresIn,
    refreshTokenExpiresInDays
  );
  const refreshTokenUseCase = new RefreshTokenUseCase(
    userRepository,
    refreshTokenRepository,
    securityAuditRepository,
    tokenService,
    jwtExpiresIn,
    refreshTokenExpiresInDays
  );
  const logoutUserUseCase = new LogoutUserUseCase(refreshTokenRepository, tokenService);
  const getCurrentUserUseCase = new GetCurrentUserUseCase(userRepository, dailyAnalysisRepository, timezone, dailyQuota);

  const submitAnalysisUseCase = new SubmitAnalysisUseCase(
    dailyAnalysisRepository,
    securityAuditRepository,
    timezone,
    dailyQuota
  );
  const listAnalysesUseCase = new ListAnalysesUseCase(dailyAnalysisRepository);
  const getAnalysisDetailUseCase = new GetAnalysisDetailUseCase(dailyAnalysisRepository);
  const processAnalysisJobUseCase = new ProcessAnalysisJobUseCase(
    dailyAnalysisRepository,
    securityAuditRepository,
    sandboxService
  );

  const listAuditEventsUseCase = new ListAuditEventsUseCase(securityAuditRepository);
  const getMetricsUseCase = new GetMetricsUseCase(dailyAnalysisRepository);

  // 3. Presentation Layer (Fastify)
  const app = buildServer({
    mongoConnection,
    tokenService,
    sandboxService,
    authDeps: {
      registerUserUseCase,
      loginUserUseCase,
      refreshTokenUseCase,
      logoutUserUseCase,
      getCurrentUserUseCase
    },
    analysisDeps: {
      submitAnalysisUseCase,
      listAnalysesUseCase,
      getAnalysisDetailUseCase,
      processAnalysisJobUseCase
    },
    adminDeps: {
      listAuditEventsUseCase,
      getMetricsUseCase
    }
  });

  // 4. Graceful Shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`[INFO] Received ${signal}. Shutting down gracefully...`);
      await app.close();
      await mongoConnection.disconnect();
      console.log('[INFO] Server and database closed. Exiting process.');
      process.exit(0);
    });
  }

  // 5. Start Server
  try {
    await app.listen({ port, host });
    console.log(`[READY] EnlaceSeguro REST API listening at http://${host}:${port}/api/v1`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap().catch((err) => {
  console.error('[FATAL] Failed to bootstrap application:', err);
  process.exit(1);
});
