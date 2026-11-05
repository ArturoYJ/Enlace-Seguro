import { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoUserRepository } from '../../src/infrastructure/database/mongo/MongoUserRepository.js';
import { MongoRefreshTokenRepository } from '../../src/infrastructure/database/mongo/MongoRefreshTokenRepository.js';
import { MongoDailyAnalysisRepository } from '../../src/infrastructure/database/mongo/MongoDailyAnalysisRepository.js';
import { AesGcmAnalysisInputCipher } from '../../src/infrastructure/security/AesGcmAnalysisInputCipher.js';
import { MongoSecurityAuditRepository } from '../../src/infrastructure/database/mongo/MongoSecurityAuditRepository.js';
import { MongoLoginRateLimitRepository } from '../../src/infrastructure/database/mongo/MongoLoginRateLimitRepository.js';
import { JwtTokenService } from '../../src/infrastructure/security/JwtTokenService.js';
import { KeyedLoginRateLimiter } from '../../src/infrastructure/security/KeyedLoginRateLimiter.js';
import { RegisterUserUseCase } from '../../src/use-cases/auth/RegisterUserUseCase.js';
import { LoginUserUseCase } from '../../src/use-cases/auth/LoginUserUseCase.js';
import { RefreshTokenUseCase } from '../../src/use-cases/auth/RefreshTokenUseCase.js';
import { LogoutUserUseCase } from '../../src/use-cases/auth/LogoutUserUseCase.js';
import { GetCurrentUserUseCase } from '../../src/use-cases/auth/GetCurrentUserUseCase.js';
import { SubmitAnalysisUseCase } from '../../src/use-cases/analysis/SubmitAnalysisUseCase.js';
import { ListAnalysesUseCase } from '../../src/use-cases/analysis/ListAnalysesUseCase.js';
import { GetAnalysisDetailUseCase } from '../../src/use-cases/analysis/GetAnalysisDetailUseCase.js';
import { GetAnalysisSummaryUseCase } from '../../src/use-cases/analysis/GetAnalysisSummaryUseCase.js';
import { ProcessAnalysisJobUseCase } from '../../src/use-cases/analysis/ProcessAnalysisJobUseCase.js';
import { ListAuditEventsUseCase } from '../../src/use-cases/admin/ListAuditEventsUseCase.js';
import { GetMetricsUseCase } from '../../src/use-cases/admin/GetMetricsUseCase.js';
import { buildServer } from '../../src/presentation/server.js';
import { HttpSandboxService } from '../../src/infrastructure/sandbox/HttpSandboxService.js';
import { AnalysisJobWorker } from '../../src/infrastructure/workers/AnalysisJobWorker.js';
import { buildSandboxServer } from '../../../sandbox/src/presentation/sandboxServer.js';
import type { IPasswordHasher } from '../../src/core/ports/ISecurityServices.js';
import type { IScreenshotStorage } from '../../../sandbox/src/infrastructure/ScreenshotStorage.js';

const DATABASE_NAME_PATTERN = /^enlaceseguro_test_e2e_[a-z0-9_-]{1,64}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ALLOWED_BIND_HOSTS = new Set([...LOOPBACK_HOSTS, '0.0.0.0']);
const MAX_PENDING_JOBS = 100;
const E2E_ADMIN_EMAIL = 'admin@enlaceseguro.example.test';
const E2E_ADMIN_PASSWORD = 'e2e-admin-password-not-for-production';
const TEST_JWT_SECRET = 'e2e-only-jwt-secret-not-for-production-32-bytes';
const TEST_RATE_LIMIT_HMAC_KEY = 'e2e-only-hmac-key-not-for-production-32-bytes';
const TEST_SANDBOX_TOKEN = 'e2e-only-sandbox-service-token-not-for-production';

export interface E2EServerConfig {
  mongoUri: string;
  databaseName: string;
  host: string;
  port: number;
}

/** Validate the local-only and disposable configuration required by this fixture. */
export function readE2EServerConfig(env: NodeJS.ProcessEnv): E2EServerConfig {
  const mongoUri = env['MONGO_TEST_URI'];
  if (!mongoUri) throw new Error('MONGO_TEST_URI is required for the installed mobile E2E fixture.');

  let parsedUri: URL;
  try {
    parsedUri = new URL(mongoUri);
  } catch {
    throw new Error('MONGO_TEST_URI must be a valid local MongoDB URI.');
  }
  if (parsedUri.protocol !== 'mongodb:' || !LOOPBACK_HOSTS.has(parsedUri.hostname.toLowerCase())) {
    throw new Error('MONGO_TEST_URI must use mongodb:// and point to localhost, 127.0.0.1, or ::1.');
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsedUri.pathname.replace(/^\//, ''));
  } catch {
    throw new Error('MONGO_TEST_URI must contain a valid database name.');
  }
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error('Refusing E2E database name; expected enlaceseguro_test_e2e_<safe suffix>.');
  }

  const host = env['E2E_API_HOST'] ?? '127.0.0.1';
  if (!ALLOWED_BIND_HOSTS.has(host)) {
    throw new Error('E2E_API_HOST must be loopback by default; 0.0.0.0 is allowed only for an isolated CI emulator job.');
  }

  const rawPort = env['E2E_API_PORT'] ?? '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('E2E_API_PORT must be an integer between 1 and 65535.');
  }

  return { mongoUri, databaseName, host, port };
}

async function assertFreshTestDatabase(db: ReturnType<MongoClient['db']>): Promise<void> {
  const names = ['users', 'daily_analyses', 'refresh_tokens', 'security_audit_events', 'login_rate_limit_buckets', 'reputation_cache'];
  for (const name of names) {
    const count = await db.collection(name).countDocuments({});
    if (count !== 0) {
      throw new Error(`Refusing non-empty E2E database collection '${name}'; use a fresh database name for each run.`);
    }
  }
  const capacity = await db.collection('analysis_queue_capacity').findOne({ _id: 'global' });
  if (!capacity || capacity['pendingCount'] !== 0 || capacity['maxPending'] !== MAX_PENDING_JOBS) {
    throw new Error('E2E database must be migrated with maxPending=100 and have an empty global queue.');
  }
}

async function main(): Promise<void> {
  const config = readE2EServerConfig(process.env);
  // Test API/Sandbox requests contain synthetic URLs only. Silence framework request logging so
  // accidental test values or future URL query strings cannot leak into CI artifacts.
  process.env['LOG_LEVEL'] = 'silent';

  const mongoClient = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 5_000 });
  let sandboxApp: ReturnType<typeof buildSandboxServer> | undefined;
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  let worker: AnalysisJobWorker | undefined;
  let closing = false;

  const close = async () => {
    if (closing) return;
    closing = true;
    await worker?.stop();
    await app?.close();
    await sandboxApp?.close();
    await mongoClient.close();
  };

  try {
    await mongoClient.connect();
    const db = mongoClient.db(config.databaseName);
    const hello = await db.admin().command({ hello: 1 });
    if (typeof hello['setName'] !== 'string' || hello['isWritablePrimary'] !== true) {
      throw new Error('E2E MongoDB must be a writable replica-set primary.');
    }

    const userRepository = new MongoUserRepository(db);
    const refreshTokenRepository = new MongoRefreshTokenRepository(db);
    const dailyAnalysisRepository = new MongoDailyAnalysisRepository(
      db,
      new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0xe2)),
      mongoClient,
      MAX_PENDING_JOBS
    );
    const auditRepository = new MongoSecurityAuditRepository(db);
    const rateLimitRepository = new MongoLoginRateLimitRepository(db);
    await Promise.all([
      dailyAnalysisRepository.assertInputEncryptionReady(),
      dailyAnalysisRepository.assertAnalysisQueueCapacityReady(),
      rateLimitRepository.assertReady(),
      assertFreshTestDatabase(db)
    ]);

    const passwordHasher: IPasswordHasher = {
      async hash(password) {
        return `e2e-sha256:${createHash('sha256').update(password, 'utf8').digest('hex')}`;
      },
      async compare(password, hash) {
        return hash === `e2e-sha256:${createHash('sha256').update(password, 'utf8').digest('hex')}`;
      }
    };
    if (process.env['E2E_SEED_ADMIN'] === 'true') {
      await userRepository.create({
        emailNormalized: E2E_ADMIN_EMAIL,
        passwordHash: await passwordHasher.hash(E2E_ADMIN_PASSWORD),
        role: 'admin',
        accountStatus: 'active'
      });
    }
    const tokenService = new JwtTokenService(TEST_JWT_SECRET, 900);

    // This pool deliberately never opens a browser or resolves the submitted URL. The E2E URL
    // is a display fixture only; all analysis output is synthetic and deterministic.
    const fakePool = {
      async analyzeUrl(attemptId: string, url: string) {
        const path = new URL(url).pathname;
        if (path === '/synthetic-failed') {
          throw new Error('Synthetic E2E processing failure.');
        }
        if (path === '/synthetic-inconclusive') {
          return {
            outcome: 'inconclusive' as const,
            attemptId,
            targetUrl: url,
            finalDestination: url,
            redirects: [],
            signals: [],
            sourceResults: [],
            reasonCode: 'tls_certificate_invalid' as const
          };
        }
        return {
          outcome: 'completed' as const,
          attemptId,
          targetUrl: url,
          finalDestination: url,
          redirects: [],
          signals: ['synthetic_e2e_signal'],
          verdict: 'sospechoso' as const,
          reasons: ['Señal sintética del entorno E2E; no corresponde a una consulta de reputación.'],
          sourceResults: []
        };
      }
    };
    const screenshotStorage: IScreenshotStorage = {
      async saveScreenshot() { return 'local://captures/e2e.webp'; },
      async getScreenshot() { return null; }
    };
    sandboxApp = buildSandboxServer({
      pool: fakePool as never,
      storage: screenshotStorage,
      serviceToken: TEST_SANDBOX_TOKEN
    });
    await sandboxApp.listen({ port: 0, host: '127.0.0.1' });
    const sandboxAddress = sandboxApp.server.address() as AddressInfo;
    const sandboxService = new HttpSandboxService(`http://127.0.0.1:${sandboxAddress.port}`, TEST_SANDBOX_TOKEN);
    const loginRateLimiter = new KeyedLoginRateLimiter(rateLimitRepository, TEST_RATE_LIMIT_HMAC_KEY);
    const registerUserUseCase = new RegisterUserUseCase(userRepository, auditRepository, passwordHasher);
    const loginUserUseCase = new LoginUserUseCase(
      userRepository,
      refreshTokenRepository,
      auditRepository,
      passwordHasher,
      tokenService,
      loginRateLimiter
    );
    const refreshTokenUseCase = new RefreshTokenUseCase(userRepository, refreshTokenRepository, auditRepository, tokenService);
    const logoutUserUseCase = new LogoutUserUseCase(refreshTokenRepository, tokenService);
    const getCurrentUserUseCase = new GetCurrentUserUseCase(userRepository, dailyAnalysisRepository);
    const submitAnalysisUseCase = new SubmitAnalysisUseCase(dailyAnalysisRepository, auditRepository);
    const listAnalysesUseCase = new ListAnalysesUseCase(dailyAnalysisRepository);
    const getAnalysisDetailUseCase = new GetAnalysisDetailUseCase(dailyAnalysisRepository);
    const processAnalysisJobUseCase = new ProcessAnalysisJobUseCase(dailyAnalysisRepository, auditRepository, sandboxService);
    const noOpMongoConnection = { ping: async () => true };

    app = buildServer({
      mongoConnection: noOpMongoConnection as never,
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
        getAnalysisSummaryUseCase: new GetAnalysisSummaryUseCase(dailyAnalysisRepository),
        getAnalysisDetailUseCase
      },
      adminDeps: {
        listAuditEventsUseCase: new ListAuditEventsUseCase(auditRepository),
        getMetricsUseCase: new GetMetricsUseCase(dailyAnalysisRepository)
      }
    });

    worker = new AnalysisJobWorker(dailyAnalysisRepository, processAnalysisJobUseCase, {
      concurrency: 1,
      pollIntervalMs: 100,
      leaseDurationMs: 60_000,
      maxAttempts: 2
    });
    await app.listen({ host: config.host, port: config.port });
    worker.start();

    console.log(`E2E API fixture listening at http://${config.host}:${config.port}/api/v1`);
    const stop = () => { void close().then(() => process.exit(0), () => process.exit(1)); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown E2E API fixture startup failure.';
    console.error(`E2E API fixture failed to start: ${message}`);
    process.exitCode = 1;
  });
}
