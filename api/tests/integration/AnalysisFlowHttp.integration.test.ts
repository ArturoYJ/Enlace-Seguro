import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { MongoClient, ObjectId } from 'mongodb';
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
import { GetAnalysisCaptureUseCase } from '../../src/use-cases/analysis/GetAnalysisCaptureUseCase.js';
import { GetAnalysisSummaryUseCase } from '../../src/use-cases/analysis/GetAnalysisSummaryUseCase.js';
import { ProcessAnalysisJobUseCase } from '../../src/use-cases/analysis/ProcessAnalysisJobUseCase.js';
import { ListAuditEventsUseCase } from '../../src/use-cases/admin/ListAuditEventsUseCase.js';
import { GetMetricsUseCase } from '../../src/use-cases/admin/GetMetricsUseCase.js';
import { buildServer } from '../../src/presentation/server.js';
import { HttpSandboxService } from '../../src/infrastructure/sandbox/HttpSandboxService.js';
import { AnalysisJobWorker } from '../../src/infrastructure/workers/AnalysisJobWorker.js';
import { buildSandboxServer } from '../../../sandbox/src/presentation/sandboxServer.js';
import { AntiSsrfGuard } from '../../../sandbox/src/core/AntiSsrfGuard.js';
import { PlaywrightContextPool } from '../../../sandbox/src/infrastructure/PlaywrightContextPool.js';
import type { IPasswordHasher } from '../../src/core/ports/ISecurityServices.js';
import type { IScreenshotStorage } from '../../../sandbox/src/infrastructure/ScreenshotStorage.js';
import { startFixtures } from '../../../tests/local/fixture-server.mjs';

const mongoUri = process.env['MONGO_TEST_URI'];
const suite = mongoUri ? describe : describe.skip;
const jwtSecret = 'analysis-flow-http-integration-secret-32-bytes-plus';
const rateLimitHmacKey = 'analysis-flow-http-rate-limit-key-32-bytes';
let client: MongoClient | undefined;
let app: Awaited<ReturnType<typeof buildServer>> | undefined;
let sandboxApp: ReturnType<typeof buildSandboxServer> | undefined;
let analysisJobWorker: AnalysisJobWorker | undefined;
let realSandboxPool: PlaywrightContextPool | undefined;
let timeoutSandboxPool: PlaywrightContextPool | undefined;
let tlsPageServer: HttpServer | undefined;
let invalidCertificateServer: HttpsServer | undefined;
let localFixtures: Awaited<ReturnType<typeof startFixtures>> | undefined;

const listenOnLoopback = async (server: HttpServer | HttpsServer): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
};

const closeFixtureServer = async (server: HttpServer | HttpsServer | undefined): Promise<void> => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
};

after(async () => {
  await analysisJobWorker?.stop();
  await app?.close();
  await sandboxApp?.close();
  await realSandboxPool?.close();
  await timeoutSandboxPool?.close();
  await localFixtures?.close();
  await Promise.all([closeFixtureServer(tlsPageServer), closeFixtureServer(invalidCertificateServer)]);
  await client?.close();
});

suite('analysis HTTP flow integration', () => {
  it('integrates API↔Sandbox HTTP, MongoDB, complete analysis flow and attempt ownership', async () => {
    assert.ok(mongoUri, 'MONGO_TEST_URI must point to an isolated disposable MongoDB test database');
    const parsed = new URL(mongoUri);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    assert.match(databaseName, /^enlaceseguro_test_[a-z0-9_-]+$/, 'refusing non-test database name');

    client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db(databaseName);
    const userRepository = new MongoUserRepository(db);
    const refreshTokenRepository = new MongoRefreshTokenRepository(db);
    const dailyAnalysisRepository = new MongoDailyAnalysisRepository(db, new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x29)), client!);
    const auditRepository = new MongoSecurityAuditRepository(db);
    const rateLimitRepository = new MongoLoginRateLimitRepository(db);
    await rateLimitRepository.assertReady();

    const passwordHasher: IPasswordHasher = {
      async hash(password) { return `integration-hash:${password}`; },
      async compare(password, hash) { return hash === `integration-hash:${password}`; }
    };
    const tokenService = new JwtTokenService(jwtSecret, 900);
    const sandboxCalls: Array<{ attemptId: string; url: string }> = [];
    const serviceToken = 'integration-sandbox-service-token-with-more-than-32-bytes';
    const [fixtureKey, fixtureCert] = await Promise.all([
      readFile(new URL('../../../sandbox/browser-tests/fixtures/localhost.key.pem', import.meta.url)),
      readFile(new URL('../../../sandbox/browser-tests/fixtures/localhost.cert.pem', import.meta.url))
    ]);
    let tlsTcpConnections = 0;
    let tlsHttpRequests = 0;
    let tlsRouteChecks = 0;
    let realPoolCaptureWrites = 0;
    let httpFixtureRequests = 0;
    let resourceBudgetHttpRequests = 0;
    let pagePort = 0;
    const realCaptureBytesByAttemptId = new Map<string, Buffer>();
    invalidCertificateServer = createHttpsServer({ key: fixtureKey, cert: fixtureCert }, (_request, response) => {
      tlsHttpRequests++;
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    });
    invalidCertificateServer.on('connection', () => { tlsTcpConnections++; });
    const tlsSubresourcePort = await listenOnLoopback(invalidCertificateServer);
    tlsPageServer = createHttpServer((request, response) => {
      httpFixtureRequests++;
      if (request.url === '/capture-flow') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html><body><main>Local capture fixture</main></body></html>');
        return;
      }
      if (request.url === '/resource-budget') {
        resourceBudgetHttpRequests++;
        const imageUrls = Array.from({ length: 256 }, (_, index) => `<img src="/resource-budget/image/${index}">`).join('');
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html><html><head><link rel="icon" href="data:,"></head><body>${imageUrls}</body></html>`);
        return;
      }
      if (request.url?.startsWith('/resource-budget/image/')) {
        resourceBudgetHttpRequests++;
        response.writeHead(200, { 'content-type': 'image/svg+xml' });
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
        return;
      }
      const resourceUrl = `https://127.0.0.1:${tlsSubresourcePort}/untrusted.svg`;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><body><img src="${resourceUrl}"><iframe src="${resourceUrl}"></iframe></body></html>`);
    });
    pagePort = await listenOnLoopback(tlsPageServer);
    localFixtures = await startFixtures();
    const tlsSubresourceUrl = `http://127.0.0.1:${pagePort}/tls-subresource`;
    const realCaptureUrl = `http://127.0.0.1:${pagePort}/capture-flow`;
    const resourceBudgetUrl = `http://127.0.0.1:${pagePort}/resource-budget`;
    const allowedFixturePorts = new Set([String(pagePort), String(tlsSubresourcePort), new URL(localFixtures.httpUrl).port, new URL(localFixtures.httpsUrl).port]);
    const controlledUrls = [`${localFixtures.httpUrl}/clean`, `${localFixtures.httpUrl}/suspicious`, `${localFixtures.httpsUrl}/tls`];
    const timeoutUrl = `${localFixtures.httpUrl}/timeout`;
    const fakePool = {
      async analyzeUrl(attemptId: string, url: string) {
        sandboxCalls.push({ attemptId, url });
        if (url === timeoutUrl) return timeoutSandboxPool!.analyzeUrl(attemptId, url);
        if (url === tlsSubresourceUrl || url === realCaptureUrl || url === resourceBudgetUrl || controlledUrls.includes(url)) {
          return realSandboxPool!.analyzeUrl(attemptId, url);
        }
        if (url.includes('/tls-invalid')) {
          return {
            outcome: 'inconclusive',
            reasonCode: 'tls_certificate_invalid',
            attemptId,
            targetUrl: url,
            finalDestination: url,
            redirects: [],
            signals: ['tls_certificate_validation_failed'],
            sourceResults: []
          };
        }
        return {
          outcome: 'completed',
          attemptId,
          targetUrl: url,
          finalDestination: url,
          redirects: [],
          signals: ['synthetic_integration_signal'],
          verdict: 'sospechoso',
          reasons: ['Señal sintética devuelta por el Sandbox de prueba.'],
          sourceResults: [],
          screenshotRef: 'local://captures/integration.webp'
        };
      }
    };
    const captureBytes = Buffer.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
    const screenshotStorage: IScreenshotStorage = {
      async saveScreenshot(attemptId, imageBuffer) {
        realPoolCaptureWrites++;
        realCaptureBytesByAttemptId.set(attemptId, Buffer.from(imageBuffer));
        return `local://captures/${attemptId}.webp`;
      },
      async getScreenshot(attemptId) { return realCaptureBytesByAttemptId.get(attemptId) ?? captureBytes; }
    };
    realSandboxPool = new PlaywrightContextPool(screenshotStorage, 1, undefined, 1, 20_000);
    // Short deadline is confined to this synthetic timeout case.
    timeoutSandboxPool = new PlaywrightContextPool(screenshotStorage, 1, undefined, 1, 1_000);
    sandboxApp = buildSandboxServer({
      pool: fakePool as never,
      storage: screenshotStorage,
      serviceToken
    });
    await sandboxApp.listen({ port: 0, host: '127.0.0.1' });
    const sandboxAddress = sandboxApp.server.address() as AddressInfo;
    const sandboxService = new HttpSandboxService(`http://127.0.0.1:${sandboxAddress.port}`, serviceToken);
    const loginRateLimiter = new KeyedLoginRateLimiter(rateLimitRepository, rateLimitHmacKey);
    const registerUserUseCase = new RegisterUserUseCase(userRepository, auditRepository, passwordHasher);
    const loginUserUseCase = new LoginUserUseCase(
      userRepository,
      refreshTokenRepository,
      auditRepository,
      passwordHasher,
      tokenService,
      loginRateLimiter
    );
    const refreshTokenUseCase = new RefreshTokenUseCase(
      userRepository,
      refreshTokenRepository,
      auditRepository,
      tokenService
    );
    const logoutUserUseCase = new LogoutUserUseCase(refreshTokenRepository, tokenService);
    const getCurrentUserUseCase = new GetCurrentUserUseCase(userRepository, dailyAnalysisRepository);
    const submitAnalysisUseCase = new SubmitAnalysisUseCase(dailyAnalysisRepository, auditRepository);
    const listAnalysesUseCase = new ListAnalysesUseCase(dailyAnalysisRepository);
    const getAnalysisDetailUseCase = new GetAnalysisDetailUseCase(dailyAnalysisRepository);
    const processAnalysisJobUseCase = new ProcessAnalysisJobUseCase(
      dailyAnalysisRepository,
      auditRepository,
      sandboxService
    );
    const unusedMongoConnection = { ping: async () => true };

    app = buildServer({
      mongoConnection: unusedMongoConnection as never,
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
        getAnalysisDetailUseCase,
        getAnalysisCaptureUseCase: new GetAnalysisCaptureUseCase(dailyAnalysisRepository, sandboxService),
        captureProxyEnabled: true
      },
      adminDeps: {
        listAuditEventsUseCase: new ListAuditEventsUseCase(auditRepository),
        getMetricsUseCase: new GetMetricsUseCase(dailyAnalysisRepository)
      }
    });
    analysisJobWorker = new AnalysisJobWorker(dailyAnalysisRepository, processAnalysisJobUseCase, {
      concurrency: 2,
      pollIntervalMs: 100,
      leaseDurationMs: 60_000
    });
    analysisJobWorker.start();

    const firstEmail = `flow-${randomUUID()}@example.test`;
    const firstPassword = 'Valid-Integration-Pass-123!';
    const invalidRegistration = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'invalid-address', password: firstPassword }
    });
    assert.equal(invalidRegistration.statusCode, 400);
    assert.equal(invalidRegistration.headers['content-type'], 'application/problem+json; charset=utf-8');
    assert.equal(invalidRegistration.json().status, 400);
    assert.match(invalidRegistration.json().type, /validation-failed/);

    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: firstEmail, password: firstPassword }
    });
    assert.equal(registered.statusCode, 201);
    assert.equal(registered.json().role, 'usuario');

    const duplicateRegistration = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: firstEmail, password: firstPassword }
    });
    assert.equal(duplicateRegistration.statusCode, 409);

    const rejectedLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: firstEmail, password: 'Wrong-Integration-Pass-123!' }
    });
    assert.equal(rejectedLogin.statusCode, 401);

    const firstLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: firstEmail, password: firstPassword }
    });
    assert.equal(firstLogin.statusCode, 200);
    const firstAccessToken = firstLogin.json().accessToken as string;
    const firstRefreshToken = firstLogin.json().refreshToken as string;
    assert.ok(firstAccessToken);
    assert.ok(firstRefreshToken);

    const submittedUrl = 'https://example.test/synthetic-path?campaign=integration';
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/analyses',
      headers: { authorization: `Bearer ${firstAccessToken}` },
      payload: { input: submittedUrl }
    });
    assert.equal(accepted.statusCode, 201);
    const acceptedBody = accepted.json() as { attemptId: string; localDate: string; processingStatus: string };
    assert.match(acceptedBody.attemptId, /^[0-9a-f-]{36}$/);
    assert.equal(acceptedBody.processingStatus, 'received');

    const invalidHistoryCursor = await app.inject({
      method: 'GET',
      url: '/api/v1/analyses?cursor=not-a-valid-cursor',
      headers: { authorization: `Bearer ${firstAccessToken}` }
    });
    assert.equal(invalidHistoryCursor.statusCode, 400);
    assert.match(invalidHistoryCursor.json().type, /validation-failed/);
    const emptyHistoryCursor = await app.inject({
      method: 'GET',
      url: '/api/v1/analyses?cursor=',
      headers: { authorization: `Bearer ${firstAccessToken}` }
    });
    assert.equal(emptyHistoryCursor.statusCode, 400);
    const invalidHistoryLimit = await app.inject({
      method: 'GET',
      url: '/api/v1/analyses?limit=51',
      headers: { authorization: `Bearer ${firstAccessToken}` }
    });
    assert.equal(invalidHistoryLimit.statusCode, 400);

    const detailPath = `/api/v1/analyses/${encodeURIComponent(acceptedBody.attemptId)}?localDate=${encodeURIComponent(acceptedBody.localDate)}`;
    let detailResponse;
    const deadline = Date.now() + 3_000;
    do {
      detailResponse = await app.inject({
        method: 'GET',
        url: detailPath,
        headers: { authorization: `Bearer ${firstAccessToken}` }
      });
      assert.equal(detailResponse.statusCode, 200);
      if (['completed', 'failed', 'inconclusive', 'validation_failed'].includes(detailResponse.json().processingStatus)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    } while (Date.now() < deadline);

    const detail = detailResponse.json();
    assert.equal(detail.processingStatus, 'completed');
    assert.equal(detail.analysis.verdict, 'sospechoso');
    assert.deepEqual(detail.analysis.signals, ['synthetic_integration_signal']);
    assert.equal('screenshotRef' in detail.analysis, false, 'internal capture references must never be public');
    assert.deepEqual(sandboxCalls, [{ attemptId: acceptedBody.attemptId, url: submittedUrl }]);

    const capturePath = `/api/v1/analyses/${acceptedBody.attemptId}/capture`;
    const captureResponse = await app.inject({ method: 'GET', url: capturePath, headers: { authorization: `Bearer ${firstAccessToken}` } });
    assert.equal(captureResponse.statusCode, 200);
    assert.equal(captureResponse.headers['content-type'], 'image/webp');
    assert.equal(captureResponse.headers['cache-control'], 'private, no-store');
    assert.deepEqual(captureResponse.rawPayload, captureBytes);

    const history = await app.inject({
      method: 'GET',
      url: '/api/v1/analyses?limit=10',
      headers: { authorization: `Bearer ${firstAccessToken}` }
    });
    assert.equal(history.statusCode, 200);
    assert.equal(history.json().items.length, 1);
    assert.equal(history.json().items[0].attemptId, acceptedBody.attemptId);
    assert.equal(history.json().items[0].processingStatus, 'completed');
    assert.equal(history.json().items[0].submittedInput, submittedUrl, 'authenticated owner should retain the prior history behavior');
    assert.equal(history.json().items[0].job, undefined, 'internal lease metadata must never be exposed in history DTOs');

    const personalSummary = await app.inject({
      method: 'GET',
      url: '/api/v1/analyses/summary',
      headers: { authorization: `Bearer ${firstAccessToken}` }
    });
    assert.equal(personalSummary.statusCode, 200);
    assert.equal(personalSummary.headers['cache-control'], 'private, no-store');
    assert.equal(personalSummary.json().total, 1);
    assert.equal(personalSummary.json().suspicious, 1);
    assert.equal(personalSummary.json().dangerous, 0);
    assert.doesNotMatch(personalSummary.body, /submittedInput|attemptId|screenshotRef|inputDigest/);

    const tlsUrl = 'https://example.test/tls-invalid';
    const tlsAccepted = await app.inject({
      method: 'POST', url: '/api/v1/analyses',
      headers: { authorization: `Bearer ${firstAccessToken}` },
      payload: { input: tlsUrl }
    });
    assert.equal(tlsAccepted.statusCode, 201);
    const tlsAdmission = tlsAccepted.json() as { attemptId: string; localDate: string };
    const tlsDetailPath = `/api/v1/analyses/${encodeURIComponent(tlsAdmission.attemptId)}?localDate=${encodeURIComponent(tlsAdmission.localDate)}`;
    let tlsDetailResponse;
    const tlsDeadline = Date.now() + 3_000;
    do {
      tlsDetailResponse = await app.inject({
        method: 'GET', url: tlsDetailPath, headers: { authorization: `Bearer ${firstAccessToken}` }
      });
      assert.equal(tlsDetailResponse.statusCode, 200);
      if (tlsDetailResponse.json().processingStatus === 'inconclusive') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    } while (Date.now() < tlsDeadline);
    const tlsDetail = tlsDetailResponse.json();
    assert.equal(tlsDetail.processingStatus, 'inconclusive');
    assert.equal(tlsDetail.analysis, undefined, 'TLS failure must not yield a security verdict');
    assert.ok(sandboxCalls.some((call) => call.url === tlsUrl));

    // Exercise actual Chromium over the API worker and Sandbox HTTP boundary using loopback-only fixtures.
    const originalIsSafeUrl = AntiSsrfGuard.isSafeUrl;
    const originalValidateDestination = AntiSsrfGuard.validateDestination;
    AntiSsrfGuard.isSafeUrl = (rawUrl: string) => {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawUrl);
      } catch {
        return originalIsSafeUrl.call(AntiSsrfGuard, rawUrl);
      }
      if (parsedUrl.hostname === '127.0.0.1' && allowedFixturePorts.has(parsedUrl.port)) {
        if (parsedUrl.port === String(tlsSubresourcePort)) tlsRouteChecks++;
        return { valid: true, parsedUrl };
      }
      return originalIsSafeUrl.call(AntiSsrfGuard, rawUrl);
    };
    AntiSsrfGuard.validateDestination = async (parsedUrl: URL) => {
      if (parsedUrl.hostname === '127.0.0.1' && allowedFixturePorts.has(parsedUrl.port)) {
        return { safe: true, resolvedIp: '127.0.0.1' };
      }
      return originalValidateDestination.call(AntiSsrfGuard, parsedUrl);
    };
    try {
      const realTlsAccepted = await app.inject({
        method: 'POST', url: '/api/v1/analyses',
        headers: { authorization: `Bearer ${firstAccessToken}` },
        payload: { input: tlsSubresourceUrl }
      });
      assert.equal(realTlsAccepted.statusCode, 201);
      const realTlsAdmission = realTlsAccepted.json() as { attemptId: string; localDate: string };
      const realTlsDetailPath = `/api/v1/analyses/${encodeURIComponent(realTlsAdmission.attemptId)}?localDate=${encodeURIComponent(realTlsAdmission.localDate)}`;
      let realTlsDetailResponse;
      const realTlsDeadline = Date.now() + 12_000;
      do {
        realTlsDetailResponse = await app.inject({
          method: 'GET', url: realTlsDetailPath,
          headers: { authorization: `Bearer ${firstAccessToken}` }
        });
        assert.equal(realTlsDetailResponse.statusCode, 200);
        if (['completed', 'failed', 'inconclusive'].includes(realTlsDetailResponse.json().processingStatus)) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      } while (Date.now() < realTlsDeadline);

      const realTlsDetail = realTlsDetailResponse.json();
      assert.equal(realTlsDetail.processingStatus, 'inconclusive');
      assert.equal(realTlsDetail.analysis, undefined, 'real Chromium TLS failure must not persist a verdict');
      assert.ok(tlsTcpConnections > 0, 'real Chromium must open TCP to the local HTTPS fixture');
      assert.ok(tlsRouteChecks >= 2, 'real Chromium must attempt the image and iframe through the real guard');
      assert.equal(tlsHttpRequests, 0, 'invalid TLS must stop both subresource HTTP requests');
      assert.equal(realPoolCaptureWrites, 0, 'inconclusive real Chromium analysis must not persist a capture');
      assert.ok(sandboxCalls.some((call) => call.url === tlsSubresourceUrl));
      const noCapture = await app.inject({
        method: 'GET', url: `/api/v1/analyses/${realTlsAdmission.attemptId}/capture`,
        headers: { authorization: `Bearer ${firstAccessToken}` }
      });
      assert.notEqual(noCapture.statusCode, 200, 'API must not serve a capture for TLS-inconclusive analysis');

      const realCaptureAccepted = await app.inject({
        method: 'POST', url: '/api/v1/analyses',
        headers: { authorization: `Bearer ${firstAccessToken}` },
        payload: { input: realCaptureUrl }
      });
      assert.equal(realCaptureAccepted.statusCode, 201);
      const realCaptureAdmission = realCaptureAccepted.json() as { attemptId: string; localDate: string };
      const realCaptureDetailPath = `/api/v1/analyses/${encodeURIComponent(realCaptureAdmission.attemptId)}?localDate=${encodeURIComponent(realCaptureAdmission.localDate)}`;
      let realCaptureDetailResponse;
      const realCaptureDeadline = Date.now() + 12_000;
      do {
        realCaptureDetailResponse = await app.inject({
          method: 'GET', url: realCaptureDetailPath,
          headers: { authorization: `Bearer ${firstAccessToken}` }
        });
        assert.equal(realCaptureDetailResponse.statusCode, 200);
        if (['completed', 'failed', 'inconclusive'].includes(realCaptureDetailResponse.json().processingStatus)) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      } while (Date.now() < realCaptureDeadline);
      const realCaptureDetail = realCaptureDetailResponse.json();
      assert.equal(realCaptureDetail.processingStatus, 'completed');
      assert.equal(realCaptureDetail.analysis.verdict, 'sin_amenazas_detectadas');
      assert.equal(realPoolCaptureWrites, 1);
      assert.ok(httpFixtureRequests >= 2, 'Chromium must load both local page fixtures');

      const realCapture = await app.inject({
        method: 'GET', url: `/api/v1/analyses/${realCaptureAdmission.attemptId}/capture`,
        headers: { authorization: `Bearer ${firstAccessToken}` }
      });
      assert.equal(realCapture.statusCode, 200);
      assert.equal(realCapture.headers['content-type'], 'image/webp');
      assert.equal(realCapture.rawPayload.subarray(0, 4).toString('ascii'), 'RIFF');
      assert.equal(realCapture.rawPayload.subarray(8, 12).toString('ascii'), 'WEBP');

      const capturesBeforeResourceBudget = realPoolCaptureWrites;
      const resourceBudgetAccepted = await app.inject({
        method: 'POST', url: '/api/v1/analyses',
        headers: { authorization: `Bearer ${firstAccessToken}` },
        payload: { input: resourceBudgetUrl }
      });
      assert.equal(resourceBudgetAccepted.statusCode, 201);
      const resourceBudgetAdmission = resourceBudgetAccepted.json() as { attemptId: string; localDate: string };
      const resourceBudgetDetailPath = `/api/v1/analyses/${encodeURIComponent(resourceBudgetAdmission.attemptId)}?localDate=${encodeURIComponent(resourceBudgetAdmission.localDate)}`;
      let resourceBudgetDetailResponse;
      const resourceBudgetDeadline = Date.now() + 12_000;
      do {
        resourceBudgetDetailResponse = await app.inject({
          method: 'GET', url: resourceBudgetDetailPath,
          headers: { authorization: `Bearer ${firstAccessToken}` }
        });
        assert.equal(resourceBudgetDetailResponse.statusCode, 200);
        if (['completed', 'failed', 'inconclusive'].includes(resourceBudgetDetailResponse.json().processingStatus)) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      } while (Date.now() < resourceBudgetDeadline);
      const resourceBudgetDetail = resourceBudgetDetailResponse.json();
      assert.equal(resourceBudgetDetail.processingStatus, 'inconclusive');
      assert.equal(resourceBudgetDetail.analysis, undefined, 'request-budget failure must not persist a security verdict');
      assert.ok(resourceBudgetHttpRequests > 1 && resourceBudgetHttpRequests <= 256, 'the 257th request must be aborted before reaching the fixture server');
      assert.equal(realPoolCaptureWrites, capturesBeforeResourceBudget, 'request-budget failure must not persist a capture');
      const resourceBudgetCapture = await app.inject({
        method: 'GET', url: `/api/v1/analyses/${resourceBudgetAdmission.attemptId}/capture`,
        headers: { authorization: `Bearer ${firstAccessToken}` }
      });
      assert.notEqual(resourceBudgetCapture.statusCode, 200, 'API must not serve a capture for an over-budget analysis');

      // Dedicated synthetic account avoids consuming the first account's quota.
      const fixtureEmail = `fixture-${randomUUID()}@example.test`;
      const fixtureRegistered = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: fixtureEmail, password: firstPassword } });
      assert.equal(fixtureRegistered.statusCode, 201);
      const fixtureLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: fixtureEmail, password: firstPassword } });
      assert.equal(fixtureLogin.statusCode, 200);
      const fixtureToken = fixtureLogin.json().accessToken as string;
      for (const [index, target] of [...controlledUrls, timeoutUrl].entries()) {
        const admission = await app.inject({ method: 'POST', url: '/api/v1/analyses', headers: { authorization: `Bearer ${fixtureToken}` }, payload: { input: target } });
        assert.equal(admission.statusCode, 201);
        const { attemptId, localDate } = admission.json() as { attemptId: string; localDate: string };
        let detail: { processingStatus: string; analysis?: { verdict: string } } | undefined;
        const deadline = Date.now() + (index === 3 ? 30_000 : 15_000);
        do {
          const response = await app.inject({ method: 'GET', url: `/api/v1/analyses/${encodeURIComponent(attemptId)}?localDate=${encodeURIComponent(localDate)}`, headers: { authorization: `Bearer ${fixtureToken}` } });
          assert.equal(response.statusCode, 200);
          detail = response.json();
          if (detail && ['completed', 'failed', 'inconclusive'].includes(detail.processingStatus)) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        } while (Date.now() < deadline);
        assert.ok(detail);
        if (index === 0) { assert.equal(detail.processingStatus, 'completed'); assert.equal(detail.analysis?.verdict, 'sin_amenazas_detectadas'); }
        if (index === 1) { assert.equal(detail.processingStatus, 'completed'); assert.notEqual(detail.analysis?.verdict, 'sin_amenazas_detectadas'); assert.ok(detail.analysis?.verdict); }
        if (index === 2) { assert.equal(detail.processingStatus, 'inconclusive'); assert.equal(detail.analysis, undefined); }
        if (index === 3) { assert.equal(detail.processingStatus, 'failed'); assert.equal(detail.analysis, undefined); assert.equal(sandboxCalls.filter(call => call.url === timeoutUrl).length, 4); }
      }
    } finally {
      AntiSsrfGuard.isSafeUrl = originalIsSafeUrl;
      AntiSsrfGuard.validateDestination = originalValidateDestination;
    }

    const secondEmail = `owner-${randomUUID()}@example.test`;
    const secondRegistered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: secondEmail, password: firstPassword }
    });
    assert.equal(secondRegistered.statusCode, 201);
    const secondLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: secondEmail, password: firstPassword }
    });
    assert.equal(secondLogin.statusCode, 200);
    const otherOwnerSummary = await app.inject({
      method: 'GET',
      url: '/api/v1/analyses/summary',
      headers: { authorization: `Bearer ${secondLogin.json().accessToken}` }
    });
    assert.equal(otherOwnerSummary.statusCode, 200);
    assert.deepEqual(otherOwnerSummary.json().total, 0);
    assert.deepEqual(otherOwnerSummary.json().suspicious, 0);
    const crossOwnerRead = await app.inject({
      method: 'GET',
      url: detailPath,
      headers: { authorization: `Bearer ${secondLogin.json().accessToken}` }
    });
    assert.equal(crossOwnerRead.statusCode, 404);
    const crossOwnerCapture = await app.inject({ method: 'GET', url: capturePath,
      headers: { authorization: `Bearer ${secondLogin.json().accessToken}` } });
    assert.equal(crossOwnerCapture.statusCode, 404);

    const adminEmail = `admin-${randomUUID()}@example.test`;
    const admin = await userRepository.create({
      emailNormalized: adminEmail,
      passwordHash: 'integration-admin-hash',
      role: 'admin',
      accountStatus: 'active'
    });
    const adminToken = tokenService.generateAccessToken({ userId: admin.id, email: adminEmail, role: 'admin' });
    const dateRange = `startDate=${acceptedBody.localDate}&endDate=${acceptedBody.localDate}`;

    const adminMetricsUnauthorized = await app.inject({ method: 'GET', url: `/api/v1/admin/metrics?${dateRange}` });
    const adminMetricsForbidden = await app.inject({
      method: 'GET', url: `/api/v1/admin/metrics?${dateRange}`,
      headers: { authorization: `Bearer ${firstAccessToken}` }
    });
    assert.equal(adminMetricsUnauthorized.statusCode, 401);
    assert.equal(adminMetricsForbidden.statusCode, 403);

    const metricsResponse = await app.inject({
      method: 'GET', url: `/api/v1/admin/metrics?${dateRange}`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(metricsResponse.statusCode, 200);
    assert.ok(metricsResponse.json().totalAttempts >= 1);
    assert.ok(metricsResponse.json().byStatus.completed >= 1);
    assert.ok(metricsResponse.json().byStatus.inconclusive >= 1);
    assert.ok(metricsResponse.json().byVerdict.sospechoso >= 1);

    const auditResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-events?startDate=2026-01-01&endDate=2026-12-31&eventType=analysis.completed&limit=5`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(auditResponse.statusCode, 200);
    const auditBody = auditResponse.json() as { items: Array<Record<string, unknown>>; hasMore: boolean; nextCursor: string | null };
    assert.ok(auditBody.items.some((event) => event['eventType'] === 'analysis.completed'));
    assert.equal(auditBody.items.some((event) => 'purgeAt' in event), false);
    assert.equal(typeof auditBody.hasMore, 'boolean');
    assert.ok(auditBody.nextCursor === null || typeof auditBody.nextCursor === 'string');

    const mexicoDayMarkers = {
      before: `tz-before-${randomUUID()}`,
      start: `tz-start-${randomUUID()}`,
      sameTime: `tz-same-time-${randomUUID()}`,
      lastMillisecond: `tz-last-ms-${randomUUID()}`,
      nextDay: `tz-next-day-${randomUUID()}`
    };
    const auditDayBoundaryEvents = [
      { marker: mexicoDayMarkers.before, occurredAt: new Date('2026-11-03T05:59:59.999Z') },
      { marker: mexicoDayMarkers.start, occurredAt: new Date('2026-11-03T06:00:00.000Z') },
      { marker: mexicoDayMarkers.sameTime, occurredAt: new Date('2026-11-03T06:00:00.000Z') },
      { marker: mexicoDayMarkers.lastMillisecond, occurredAt: new Date('2026-11-04T05:59:59.999Z') },
      { marker: mexicoDayMarkers.nextDay, occurredAt: new Date('2026-11-04T06:00:00.000Z') }
    ];
    for (const event of auditDayBoundaryEvents) {
      await auditRepository.record({
        occurredAt: event.occurredAt,
        purgeAt: new Date('2027-12-31T00:00:00.000Z'),
        eventType: 'analysis.accepted',
        actorType: 'user',
        actorId: admin.id,
        action: 'timezone_boundary_test',
        outcome: 'success',
        resourceType: 'attempt',
        resourceId: event.marker
      });
    }
    const mexicoDayAuditResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-events?startDate=2026-11-03&endDate=2026-11-03&eventType=analysis.accepted&limit=100',
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(mexicoDayAuditResponse.statusCode, 200);
    const mexicoDayRows = (mexicoDayAuditResponse.json() as { items: Array<{ resourceId?: string }> }).items;
    const returnedBoundaryMarkers = new Set(mexicoDayRows.map((event) => event.resourceId).filter((id) => id?.startsWith('tz-')));
    assert.deepEqual(returnedBoundaryMarkers, new Set([mexicoDayMarkers.start, mexicoDayMarkers.sameTime, mexicoDayMarkers.lastMillisecond]));

    // Follow real Mongo cursors through the HTTP contract, including ties in
    // timestamps and other events that may exist on the selected day.
    const pageIds: string[] = [];
    const pageResources: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({ startDate: '2026-11-03', endDate: '2026-11-03', eventType: 'analysis.accepted', limit: '1' });
      if (cursor) query.set('cursor', cursor);
      const response = await app.inject({ method: 'GET', url: `/api/v1/admin/audit-events?${query}`, headers: { authorization: `Bearer ${adminToken}` } });
      assert.equal(response.statusCode, 200);
      const body = response.json() as { items: Array<{ id: string; resourceId?: string }>; hasMore: boolean; nextCursor: string | null };
      assert.ok(body.items.length <= 1);
      for (const item of body.items) { pageIds.push(item.id); if (item.resourceId) pageResources.push(item.resourceId); }
      if (!body.hasMore) { assert.equal(body.nextCursor, null); break; }
      assert.ok(body.nextCursor && body.nextCursor !== cursor, 'cursor must advance');
      cursor = body.nextCursor;
      assert.ok(page < 99, 'pagination must terminate');
    }
    assert.equal(new Set(pageIds).size, pageIds.length, 'pages must not repeat events');
    for (const marker of [mexicoDayMarkers.start, mexicoDayMarkers.sameTime, mexicoDayMarkers.lastMillisecond]) assert.ok(pageResources.includes(marker));

    const invalidAuditCursor = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-events?startDate=2026-01-01&endDate=2026-12-31&cursor=not-a-valid-cursor`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(invalidAuditCursor.statusCode, 400);
    assert.equal(invalidAuditCursor.headers['content-type'], 'application/problem+json; charset=utf-8');
    assert.match(invalidAuditCursor.json().type, /validation-failed/);
    const emptyAuditCursor = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-events?startDate=2026-01-01&endDate=2026-12-31&cursor=`,
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert.equal(emptyAuditCursor.statusCode, 400);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: firstRefreshToken }
    });
    assert.equal(logout.statusCode, 204);
    const staleRefresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: firstRefreshToken }
    });
    assert.equal(staleRefresh.statusCode, 401, 'a refresh token revoked by logout cannot renew a session');
    const firstUser = await db.collection<{ _id: ObjectId; emailNormalized: string }>('users').findOne({
      emailNormalized: firstEmail.trim().toLowerCase()
    });
    assert.ok(firstUser);
    const storedRefreshTokens = await db.collection<{ isRevoked: boolean }>('refresh_tokens').find({ userId: firstUser._id }).toArray();
    assert.equal(storedRefreshTokens.length, 1);
    assert.equal(storedRefreshTokens[0]?.isRevoked, true);

    await db.collection('users').deleteOne({ _id: new ObjectId(admin.id) });
  });
});
