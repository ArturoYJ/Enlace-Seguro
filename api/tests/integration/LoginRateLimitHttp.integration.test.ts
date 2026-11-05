import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { LoginUserUseCase } from '../../src/use-cases/auth/LoginUserUseCase.js';
import { JwtTokenService } from '../../src/infrastructure/security/JwtTokenService.js';
import { KeyedLoginRateLimiter } from '../../src/infrastructure/security/KeyedLoginRateLimiter.js';
import { MongoUserRepository } from '../../src/infrastructure/database/mongo/MongoUserRepository.js';
import { MongoRefreshTokenRepository } from '../../src/infrastructure/database/mongo/MongoRefreshTokenRepository.js';
import { MongoSecurityAuditRepository } from '../../src/infrastructure/database/mongo/MongoSecurityAuditRepository.js';
import { MongoLoginRateLimitRepository } from '../../src/infrastructure/database/mongo/MongoLoginRateLimitRepository.js';
import { buildServer } from '../../src/presentation/server.js';

const mongoUri = process.env['MONGO_TEST_URI'];
const suite = mongoUri ? describe : describe.skip;
const hmacKey = 'integration-test-rate-limit-hmac-key-32-bytes';
let client: MongoClient | undefined;
let app: Awaited<ReturnType<typeof buildServer>> | undefined;

after(async () => {
  await app?.close();
  await client?.close();
});

suite('login rate-limit HTTP integration', () => {
  it('returns 429 with Retry-After at the shared IP threshold and honors configured proxy CIDRs', async () => {
    assert.ok(mongoUri, 'MONGO_TEST_URI must point to an isolated disposable MongoDB test database');
    const parsed = new URL(mongoUri);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    assert.match(databaseName, /^enlaceseguro_test_[a-z0-9_-]+$/, 'refusing non-test database name');

    client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db(databaseName);
    const previousTrustedProxyCidrs = process.env['TRUST_PROXY_CIDRS'];
    process.env['TRUST_PROXY_CIDRS'] = '127.0.0.1/32';

    const users = new MongoUserRepository(db);
    const refreshTokens = new MongoRefreshTokenRepository(db);
    const audit = new MongoSecurityAuditRepository(db);
    const rateLimitRepository = new MongoLoginRateLimitRepository(db);
    await rateLimitRepository.assertReady();
    const limiter = new KeyedLoginRateLimiter(rateLimitRepository, hmacKey);
    const passwordHasher = {
      async hash(password: string) { return `hashed:${password}`; },
      async compare(password: string, hash: string) { return hash === `hashed:${password}`; }
    };
    const tokenService = new JwtTokenService('integration_jwt_secret_with_more_than_32_bytes!', 900);
    const loginUserUseCase = new LoginUserUseCase(
      users,
      refreshTokens,
      audit,
      passwordHasher,
      tokenService,
      limiter
    );
    const unused = { execute: async () => ({}) };
    const fakeMongoConnection = { ping: async () => true };

    try {
      app = buildServer({
        mongoConnection: fakeMongoConnection as never,
        tokenService,
        authDeps: {
          registerUserUseCase: unused,
          loginUserUseCase,
          refreshTokenUseCase: unused,
          logoutUserUseCase: unused,
          getCurrentUserUseCase: unused
        } as never,
        analysisDeps: {
          submitAnalysisUseCase: unused,
          listAnalysesUseCase: unused,
          getAnalysisDetailUseCase: unused
        } as never,
        adminDeps: {
          listAuditEventsUseCase: unused,
          getMetricsUseCase: unused
        } as never
      });

      const remoteIp = '203.0.113.51';
      const tryLogin = (email: string, forwardedIp = remoteIp) => app!.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': forwardedIp },
        payload: { email, password: 'wrong-password' }
      });

      const emails = [0, 1, 2].map((index) => `missing-${index}-${randomUUID()}@example.test`);
      for (let index = 0; index < 20; index += 1) {
        const response = await tryLogin(emails[index % emails.length]);
        assert.equal(response.statusCode, 401, `attempt ${index + 1} should reach credential validation`);
      }

      const blocked = await tryLogin(emails[0]!);
      assert.equal(blocked.statusCode, 429);
      assert.match(blocked.headers['retry-after'] ?? '', /^[1-9][0-9]*$/);
      assert.equal(blocked.json().status, 429);

      const ipBucketId = `v1:${createHmac('sha256', hmacKey)
        .update(`enlaceseguro-login-rate:v1:ip:${remoteIp}`)
        .digest('hex')}`;
      assert.equal((await db.collection('login_rate_limit_buckets').findOne({ _id: ipBucketId }))?.events.length, 20);

      const differentTrustedClient = await tryLogin(`another-${randomUUID()}@example.test`, '203.0.113.52');
      assert.equal(differentTrustedClient.statusCode, 401, 'a different forwarded client IP has an independent bucket');

      const accountEmail = `rate-limit-${randomUUID()}@example.test`;
      await users.create({
        emailNormalized: accountEmail,
        passwordHash: 'hashed:correct-password',
        role: 'usuario',
        accountStatus: 'active'
      });
      const accountTryLogin = (password: string) => app!.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': '203.0.113.53' },
        payload: { email: accountEmail, password }
      });
      for (let index = 0; index < 9; index += 1) {
        assert.equal((await accountTryLogin('wrong-password')).statusCode, 401);
      }
      assert.equal((await accountTryLogin('correct-password')).statusCode, 200);
      const accountBucketId = `v1:${createHmac('sha256', hmacKey)
        .update(`enlaceseguro-login-rate:v1:account:${accountEmail}`)
        .digest('hex')}`;
      assert.equal(await db.collection('login_rate_limit_buckets').countDocuments({ _id: accountBucketId }), 0);

      const accountFailuresOnSeparateIp = (password: string) => app!.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': '203.0.113.54' },
        payload: { email: accountEmail, password }
      });
      for (let index = 0; index < 10; index += 1) {
        assert.equal((await accountFailuresOnSeparateIp('wrong-password')).statusCode, 401);
      }
      const accountBlocked = await accountFailuresOnSeparateIp('wrong-password');
      assert.equal(accountBlocked.statusCode, 429);
      assert.match(accountBlocked.headers['retry-after'] ?? '', /^[1-9][0-9]*$/);
      assert.equal((await db.collection('login_rate_limit_buckets').findOne({ _id: accountBucketId }))?.events.length, 10);

      const concurrentAccountEmail = `concurrent-rate-limit-${randomUUID()}@example.test`;
      await users.create({
        emailNormalized: concurrentAccountEmail,
        passwordHash: 'hashed:correct-password',
        role: 'usuario',
        accountStatus: 'active'
      });
      const simultaneousAttempts = Array.from({ length: 20 }, (_, index) => app!.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': `203.0.113.${60 + Math.floor(index / 10)}` },
        payload: { email: concurrentAccountEmail, password: 'wrong-password' }
      }));
      const simultaneousResponses = await Promise.all(simultaneousAttempts);
      assert.equal(simultaneousResponses.filter((response) => response.statusCode === 401).length, 10);
      assert.equal(simultaneousResponses.filter((response) => response.statusCode === 429).length, 10);
    } finally {
      if (previousTrustedProxyCidrs === undefined) delete process.env['TRUST_PROXY_CIDRS'];
      else process.env['TRUST_PROXY_CIDRS'] = previousTrustedProxyCidrs;
    }
  });
});
