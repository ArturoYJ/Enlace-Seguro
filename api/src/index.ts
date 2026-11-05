import 'dotenv/config';
import { MongoDbConnection } from './infrastructure/database/mongo/MongoDbConnection.js';
import { MongoUserRepository } from './infrastructure/database/mongo/MongoUserRepository.js';
import { MongoRefreshTokenRepository } from './infrastructure/database/mongo/MongoRefreshTokenRepository.js';
import { MongoDailyAnalysisRepository } from './infrastructure/database/mongo/MongoDailyAnalysisRepository.js';
import { MongoSecurityAuditRepository } from './infrastructure/database/mongo/MongoSecurityAuditRepository.js';
import { BcryptPasswordHasher } from './infrastructure/security/BcryptPasswordHasher.js';
import { JwtTokenService } from './infrastructure/security/JwtTokenService.js';
import { KeyedLoginRateLimiter } from './infrastructure/security/KeyedLoginRateLimiter.js';
import { AesGcmAnalysisInputCipher } from './infrastructure/security/AesGcmAnalysisInputCipher.js';
import { MongoLoginRateLimitRepository } from './infrastructure/database/mongo/MongoLoginRateLimitRepository.js';
import { HttpSandboxService, resolveSandboxServiceUrl } from './infrastructure/sandbox/HttpSandboxService.js';
import { AnalysisJobWorker } from './infrastructure/workers/AnalysisJobWorker.js';
import { RegisterUserUseCase } from './use-cases/auth/RegisterUserUseCase.js';
import { LoginUserUseCase } from './use-cases/auth/LoginUserUseCase.js';
import { RefreshTokenUseCase } from './use-cases/auth/RefreshTokenUseCase.js';
import { LogoutUserUseCase } from './use-cases/auth/LogoutUserUseCase.js';
import { GetCurrentUserUseCase } from './use-cases/auth/GetCurrentUserUseCase.js';
import { SubmitAnalysisUseCase } from './use-cases/analysis/SubmitAnalysisUseCase.js';
import { ListAnalysesUseCase } from './use-cases/analysis/ListAnalysesUseCase.js';
import { GetAnalysisDetailUseCase } from './use-cases/analysis/GetAnalysisDetailUseCase.js';
import { GetAnalysisCaptureUseCase } from './use-cases/analysis/GetAnalysisCaptureUseCase.js';
import { GetAnalysisSummaryUseCase } from './use-cases/analysis/GetAnalysisSummaryUseCase.js';
import { ProcessAnalysisJobUseCase } from './use-cases/analysis/ProcessAnalysisJobUseCase.js';
import { ListAuditEventsUseCase } from './use-cases/admin/ListAuditEventsUseCase.js';
import { GetMetricsUseCase } from './use-cases/admin/GetMetricsUseCase.js';
import { buildServer } from './presentation/server.js';

async function bootstrap() {
  const port = parseInt(process.env['PORT'] || '3000', 10);
  const host = process.env['HOST'] || '0.0.0.0';
  const mongoUri = process.env['MONGODB_URI'] || 'mongodb://localhost:27017';
  const dbName = process.env['MONGODB_DB_NAME'] || 'enlaceseguro_dev';
  const sandboxUrl = resolveSandboxServiceUrl(process.env['SANDBOX_SERVICE_URL']);
  const sandboxServiceToken = process.env['SANDBOX_SERVICE_TOKEN'];
  if (!sandboxServiceToken || Buffer.byteLength(sandboxServiceToken, 'utf8') < 32 || /\s/.test(sandboxServiceToken)) {
    throw new Error('SANDBOX_SERVICE_TOKEN must be configured with at least 32 UTF-8 bytes and no whitespace.');
  }
  const jwtSecret = process.env['JWT_SECRET'] || 'development_jwt_secret_must_be_at_least_32_characters_long!';
  const jwtExpiresIn = parseInt(process.env['JWT_EXPIRES_IN_SECONDS'] || '900', 10);
  const refreshTokenExpiresInDays = parseInt(process.env['REFRESH_TOKEN_EXPIRES_IN_DAYS'] || '7', 10);
  const timezone = process.env['TIMEZONE'] || 'America/Mexico_City';
  const dailyQuota = parseInt(process.env['DAILY_ANALYSIS_QUOTA'] || '5', 10);
  const analysisJobConcurrency = Number(process.env['ANALYSIS_JOB_CONCURRENCY'] ?? 2);
  const analysisJobPollIntervalMs = Number(process.env['ANALYSIS_JOB_POLL_INTERVAL_MS'] ?? 1000);
  const analysisJobMaxAttempts = Number(process.env['ANALYSIS_JOB_MAX_ATTEMPTS'] ?? 4);
  const analysisJobSnapshotIntervalMs = Number(process.env['ANALYSIS_JOB_SNAPSHOT_INTERVAL_MS'] ?? 60_000);
  if (!Number.isInteger(analysisJobSnapshotIntervalMs) || analysisJobSnapshotIntervalMs < 10_000 || analysisJobSnapshotIntervalMs > 300_000) {
    throw new Error('ANALYSIS_JOB_SNAPSHOT_INTERVAL_MS must be an integer between 10000 and 300000.');
  }
  const analysisJobMaxPendingRaw = process.env['ANALYSIS_JOB_MAX_PENDING'];
  if (process.env['NODE_ENV'] === 'production' && !analysisJobMaxPendingRaw) {
    throw new Error('ANALYSIS_JOB_MAX_PENDING must be explicitly configured in production.');
  }
  const analysisJobMaxPending = Number(analysisJobMaxPendingRaw ?? 1000);
  if (!Number.isSafeInteger(analysisJobMaxPending) || analysisJobMaxPending < 1 || analysisJobMaxPending > 1_000_000_000) {
    throw new Error('ANALYSIS_JOB_MAX_PENDING must be an integer between 1 and 1000000000.');
  }
  const loginRateLimitHmacKey = process.env['LOGIN_RATE_LIMIT_HMAC_KEY'];
  if (!loginRateLimitHmacKey || Buffer.byteLength(loginRateLimitHmacKey, 'utf8') < 32 || /\s/.test(loginRateLimitHmacKey)) {
    throw new Error('LOGIN_RATE_LIMIT_HMAC_KEY must be configured with at least 32 UTF-8 bytes and no whitespace.');
  }
  const analysisInputEncryptionKey = process.env['ANALYSIS_INPUT_ENCRYPTION_KEY'];
  if (!analysisInputEncryptionKey) {
    throw new Error('ANALYSIS_INPUT_ENCRYPTION_KEY must be configured with a canonical base64url-encoded 32-byte key.');
  }
  const analysisInputCipher = AesGcmAnalysisInputCipher.fromBase64UrlKey(analysisInputEncryptionKey);
  const captureProxyEnabledRaw = process.env['CAPTURE_PROXY_ENABLED'] ?? 'false';
  if (!['true', 'false'].includes(captureProxyEnabledRaw)) throw new Error('CAPTURE_PROXY_ENABLED must be true or false.');

  // 1. Infrastructure Adapters
  const mongoConnection = new MongoDbConnection(mongoUri, dbName);
  let db;
  let mongoConnected = false;
  try {
    db = await mongoConnection.connect();
    mongoConnected = true;
    console.log(`[INFO] Connected to MongoDB database: ${dbName}`);
  } catch (err) {
    console.warn('[WARN] MongoDB connection failed on startup. Running in offline/degraded mode; database-dependent requests will fail closed until recovery.');
  }
  if (mongoConnected) await mongoConnection.assertReplicaSetReady();

  // Fallback db dummy if not connected initially
  const activeDb = db ?? mongoConnection.getDatabase();

  const userRepository = new MongoUserRepository(activeDb);
  const refreshTokenRepository = new MongoRefreshTokenRepository(activeDb);
  const dailyAnalysisRepository = new MongoDailyAnalysisRepository(
    activeDb,
    analysisInputCipher,
    mongoConnection.getClient(),
    analysisJobMaxPending
  );
  const securityAuditRepository = new MongoSecurityAuditRepository(activeDb);
  const loginRateLimitRepository = new MongoLoginRateLimitRepository(activeDb);
  if (mongoConnected) {
    await dailyAnalysisRepository.assertInputEncryptionReady();
    await dailyAnalysisRepository.assertAnalysisQueueCapacityReady();
    await loginRateLimitRepository.assertReady();
  }
  const loginRateLimiter = new KeyedLoginRateLimiter(loginRateLimitRepository, loginRateLimitHmacKey);

  const passwordHasher = new BcryptPasswordHasher(12);
  const tokenService = new JwtTokenService(jwtSecret, jwtExpiresIn);
  const sandboxAnalysisTimeoutMs = Number(process.env['SANDBOX_ANALYSIS_TIMEOUT_MS'] ?? 30_000);
  const sandboxService = new HttpSandboxService(sandboxUrl, sandboxServiceToken, sandboxAnalysisTimeoutMs);
  const analysisJobLeaseMs = Number(process.env['ANALYSIS_JOB_LEASE_MS'] ?? Math.max(180_000, sandboxAnalysisTimeoutMs + 10_000));
  if (!Number.isInteger(analysisJobLeaseMs) || analysisJobLeaseMs < sandboxAnalysisTimeoutMs + 10_000) {
    throw new Error('ANALYSIS_JOB_LEASE_MS must be at least 10000 milliseconds longer than the Sandbox HTTP timeout.');
  }
  const analysisJobShutdownGraceMs = Number(
    process.env['ANALYSIS_JOB_SHUTDOWN_GRACE_MS'] ?? Math.min(sandboxAnalysisTimeoutMs + 10_000, analysisJobLeaseMs - 1)
  );
  if (!Number.isInteger(analysisJobShutdownGraceMs) || analysisJobShutdownGraceMs < sandboxAnalysisTimeoutMs + 5_000 || analysisJobShutdownGraceMs >= analysisJobLeaseMs) {
    throw new Error('ANALYSIS_JOB_SHUTDOWN_GRACE_MS must be at least 5000 milliseconds longer than the Sandbox HTTP timeout and shorter than ANALYSIS_JOB_LEASE_MS.');
  }
  if (!Number.isInteger(analysisJobMaxAttempts) || analysisJobMaxAttempts < 1 || analysisJobMaxAttempts > 10) {
    throw new Error('ANALYSIS_JOB_MAX_ATTEMPTS must be an integer between 1 and 10.');
  }

  // 2. Use Cases Orchestration
  const registerUserUseCase = new RegisterUserUseCase(userRepository, securityAuditRepository, passwordHasher);
  const loginUserUseCase = new LoginUserUseCase(
    userRepository,
    refreshTokenRepository,
    securityAuditRepository,
    passwordHasher,
    tokenService,
    loginRateLimiter,
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
  const getAnalysisSummaryUseCase = new GetAnalysisSummaryUseCase(dailyAnalysisRepository);
  const getAnalysisDetailUseCase = new GetAnalysisDetailUseCase(dailyAnalysisRepository);
  const processAnalysisJobUseCase = new ProcessAnalysisJobUseCase(
    dailyAnalysisRepository,
    securityAuditRepository,
    sandboxService,
    analysisJobMaxAttempts
  );
  const analysisJobWorker = new AnalysisJobWorker(dailyAnalysisRepository, processAnalysisJobUseCase, {
    concurrency: analysisJobConcurrency,
    pollIntervalMs: analysisJobPollIntervalMs,
    leaseDurationMs: analysisJobLeaseMs,
    shutdownGraceMs: analysisJobShutdownGraceMs,
    maxAttempts: analysisJobMaxAttempts,
    snapshotIntervalMs: analysisJobSnapshotIntervalMs,
    onError: (message) => console.error(`[WARN] ${message}`),
    onSnapshot: (snapshot) => console.info(JSON.stringify({
      event: 'analysis_queue_snapshot',
      timestamp: new Date().toISOString(),
      ...snapshot
    }))
  });

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
      getAnalysisSummaryUseCase,
      getAnalysisDetailUseCase,
      getAnalysisCaptureUseCase: new GetAnalysisCaptureUseCase(dailyAnalysisRepository, sandboxService),
      captureProxyEnabled: captureProxyEnabledRaw === 'true'
    },
    adminDeps: {
      listAuditEventsUseCase,
      getMetricsUseCase
    }
  });

  // 4. Graceful Shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  let shutdownStarted = false;
  for (const signal of signals) {
    process.once(signal, async () => {
      if (shutdownStarted) return;
      shutdownStarted = true;
      console.log(`[INFO] Received ${signal}. Shutting down gracefully...`);
      const drainResult = await analysisJobWorker.stop();
      await app.close();
      await mongoConnection.disconnect();
      if (drainResult.status === 'timed_out') {
        console.error('[WARN] Worker drain did not finish; process exiting non-zero so active jobs recover after lease expiry.');
        process.exit(1);
      }
      console.log('[INFO] Server and database closed. Exiting process.');
      process.exit(0);
    });
  }

  // 5. Start Server
  try {
    await app.listen({ port, host });
    analysisJobWorker.start();
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
