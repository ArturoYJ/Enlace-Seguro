import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RegisterUserUseCase } from '../../../src/use-cases/auth/RegisterUserUseCase.js';
import { LoginUserUseCase } from '../../../src/use-cases/auth/LoginUserUseCase.js';
import { RefreshTokenUseCase } from '../../../src/use-cases/auth/RefreshTokenUseCase.js';
import { SubmitAnalysisUseCase } from '../../../src/use-cases/analysis/SubmitAnalysisUseCase.js';
import {
  MockUserRepository,
  MockRefreshTokenRepository,
  MockSecurityAuditRepository,
  MockDailyAnalysisRepository,
  MockPasswordHasher,
  MockLoginRateLimiter
} from '../../mocks/MockRepositories.js';
import { JwtTokenService } from '../../../src/infrastructure/security/JwtTokenService.js';
import {
  EmailAlreadyExistsError,
  InvalidCredentialsError,
  TokenExpiredOrInvalidError,
  TokenReuseDetectedError,
  QuotaExceededError,
  ValidationError,
  AnalysisQueueCapacityExceededError
} from '../../../src/core/errors/DomainErrors.js';

describe('Auth & Analysis Use Cases', () => {
  let userRepo: MockUserRepository;
  let tokenRepo: MockRefreshTokenRepository;
  let auditRepo: MockSecurityAuditRepository;
  let dailyRepo: MockDailyAnalysisRepository;
  let hasher: MockPasswordHasher;
  let tokenService: JwtTokenService;
  let loginRateLimiter: MockLoginRateLimiter;

  beforeEach(() => {
    userRepo = new MockUserRepository();
    tokenRepo = new MockRefreshTokenRepository();
    auditRepo = new MockSecurityAuditRepository();
    dailyRepo = new MockDailyAnalysisRepository();
    hasher = new MockPasswordHasher();
    tokenService = new JwtTokenService('test_secret_32_characters_minimum_length_required!', 900);
    loginRateLimiter = new MockLoginRateLimiter();
  });

  describe('RegisterUserUseCase', () => {
    it('should register a new user with normalized email and usuario role', async () => {
      const useCase = new RegisterUserUseCase(userRepo, auditRepo, hasher);
      const result = await useCase.execute({
        email: '  User@Example.COM  ',
        password: 'ValidPassword123!'
      });

      assert.equal(result.email, 'user@example.com');
      assert.equal(result.role, 'usuario');
      assert.equal(result.accountStatus, 'active');
      assert.equal(userRepo.users.length, 1);
      assert.equal(auditRepo.events.length, 1);
      assert.equal(auditRepo.events[0]?.eventType, 'account.registered');
    });

    it('should reject registration if email is already taken', async () => {
      const useCase = new RegisterUserUseCase(userRepo, auditRepo, hasher);
      await useCase.execute({
        email: 'user@example.com',
        password: 'Password123!'
      });

      await assert.rejects(
        () =>
          useCase.execute({
            email: 'USER@example.com',
            password: 'AnotherPassword123!'
          }),
        EmailAlreadyExistsError
      );

      assert.equal(auditRepo.events.length, 2);
      assert.equal(auditRepo.events[1]?.outcome, 'failure');
    });

    it('should reject invalid email or short password', async () => {
      const useCase = new RegisterUserUseCase(userRepo, auditRepo, hasher);

      await assert.rejects(
        () => useCase.execute({ email: 'notanemail', password: 'Password123!' }),
        ValidationError
      );

      await assert.rejects(
        () => useCase.execute({ email: 'test@example.com', password: 'short' }),
        ValidationError
      );
    });
  });

  describe('LoginUserUseCase', () => {
    it('should authenticate valid credentials and issue token pair', async () => {
      const registerUseCase = new RegisterUserUseCase(userRepo, auditRepo, hasher);
      await registerUseCase.execute({
        email: 'login@example.com',
        password: 'SecretPassword123!'
      });

      const loginUseCase = new LoginUserUseCase(userRepo, tokenRepo, auditRepo, hasher, tokenService, loginRateLimiter);
      const tokens = await loginUseCase.execute({
        email: 'login@example.com',
        password: 'SecretPassword123!',
        clientIp: '203.0.113.17'
      });

      assert.ok(tokens.accessToken);
      assert.ok(tokens.refreshToken);
      assert.equal(tokens.tokenType, 'Bearer');
      assert.equal(tokens.expiresIn, 900);
      assert.equal(tokenRepo.tokens.length, 1);
      assert.deepEqual(loginRateLimiter.clearedAccounts, ['login@example.com']);
    });

    it('should reject incorrect password with InvalidCredentialsError', async () => {
      const registerUseCase = new RegisterUserUseCase(userRepo, auditRepo, hasher);
      await registerUseCase.execute({
        email: 'login@example.com',
        password: 'CorrectPassword123!'
      });

      const loginUseCase = new LoginUserUseCase(userRepo, tokenRepo, auditRepo, hasher, tokenService, loginRateLimiter);

      await assert.rejects(
        () =>
          loginUseCase.execute({
            email: 'login@example.com',
            password: 'WrongPassword123!',
            clientIp: '203.0.113.17'
          }),
        InvalidCredentialsError
      );

      const failedEvent = auditRepo.events.find((e) => e.eventType === 'auth.login.failed');
      assert.ok(failedEvent);
      assert.deepEqual(loginRateLimiter.accountFailures, ['login@example.com']);
    });
  });

  describe('RefreshTokenUseCase', () => {
    it('should rotate valid refresh token issuing a new pair and revoking the old token', async () => {
      const registerUseCase = new RegisterUserUseCase(userRepo, auditRepo, hasher);
      const user = await registerUseCase.execute({
        email: 'refresh@example.com',
        password: 'Password123!'
      });

      const loginUseCase = new LoginUserUseCase(userRepo, tokenRepo, auditRepo, hasher, tokenService, loginRateLimiter);
      const initialTokens = await loginUseCase.execute({
        email: 'refresh@example.com',
        password: 'Password123!',
        clientIp: '203.0.113.17'
      });

      const refreshUseCase = new RefreshTokenUseCase(userRepo, tokenRepo, auditRepo, tokenService);
      const newTokens = await refreshUseCase.execute({
        refreshToken: initialTokens.refreshToken
      });

      assert.ok(newTokens.accessToken);
      assert.ok(newTokens.refreshToken);
      assert.notEqual(newTokens.refreshToken, initialTokens.refreshToken);

      // The previous token is now revoked
      const oldToken = tokenRepo.tokens[0];
      assert.equal(oldToken?.isRevoked, true);

      // The new token is active
      const activeToken = tokenRepo.tokens[1];
      assert.equal(activeToken?.isRevoked, false);
      assert.equal(activeToken?.familyId, oldToken?.familyId);
    });

    it('should detect token reuse and revoke all tokens in the family', async () => {
      const registerUseCase = new RegisterUserUseCase(userRepo, auditRepo, hasher);
      await registerUseCase.execute({
        email: 'theft@example.com',
        password: 'Password123!'
      });

      const loginUseCase = new LoginUserUseCase(userRepo, tokenRepo, auditRepo, hasher, tokenService, loginRateLimiter);
      const tokens = await loginUseCase.execute({
        email: 'theft@example.com',
        password: 'Password123!',
        clientIp: '203.0.113.17'
      });

      const refreshUseCase = new RefreshTokenUseCase(userRepo, tokenRepo, auditRepo, tokenService);
      // Legitimate rotation:
      await refreshUseCase.execute({ refreshToken: tokens.refreshToken });

      // Attacker attempts to replay the already consumed token:
      await assert.rejects(
        () => refreshUseCase.execute({ refreshToken: tokens.refreshToken }),
        TokenReuseDetectedError
      );

      // Entire family is revoked:
      assert.ok(tokenRepo.tokens.every((t) => t.isRevoked === true));
      const deniedEvent = auditRepo.events.find(
        (e) => e.eventType === 'authz.denied' && e.metadata?.['reasonCode'] === 'token_reuse_detected'
      );
      assert.ok(deniedEvent);
    });
  });

  describe('SubmitAnalysisUseCase & Quota Enforcement', () => {
    it('should admit analysis and enforce max 5 requests per day', async () => {
      const submitUseCase = new SubmitAnalysisUseCase(dailyRepo, auditRepo, 'America/Mexico_City', 5);
      const userId = 'user-123';

      // 5 allowed submissions
      for (let i = 1; i <= 5; i++) {
        const admission = await submitUseCase.execute({
          userId,
          input: `https://suspicious-site-${i}.example`
        });
        assert.ok(admission.attemptId);
        assert.equal(admission.processingStatus, 'received');
      }

      // 6th submission must be rejected with QuotaExceededError
      await assert.rejects(
        () =>
          submitUseCase.execute({
            userId,
            input: 'https://sixth-submission-rejected.example'
          }),
        QuotaExceededError
      );

      // Rejection must NOT be saved in daily analyses or audit
      const todayLocalDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
      const daily = await dailyRepo.findDailyAnalysis(userId, todayLocalDate);
      assert.equal(daily?.attemptsCount, 5);

      const quotaRejectionAudit = auditRepo.events.find((e) => e.metadata?.['reasonCode'] === 'quota_exceeded');
      assert.equal(quotaRejectionAudit, undefined);
    });

    it('persists the complete accepted input through the 64 KiB boundary and rejects larger input before quota admission', async () => {
      const submitUseCase = new SubmitAnalysisUseCase(dailyRepo, auditRepo, 'America/Mexico_City', 5);
      const userId = 'user-large-input';
      const prefix = 'https://example.test/';
      const input = prefix + 'x'.repeat(65_536 - Buffer.byteLength(prefix, 'utf8'));

      const admission = await submitUseCase.execute({ userId, input });
      const stored = await dailyRepo.findAttemptByLocalKey(userId, admission.localDate, admission.attemptId);
      assert.equal(stored?.attempt.inputSizeBytes, 65_536);
      assert.equal(stored?.attempt.submittedInput, input);

      await assert.rejects(
        () => submitUseCase.execute({ userId, input: `${input}x` }),
        ValidationError
      );
      const daily = await dailyRepo.findDailyAnalysis(userId, admission.localDate);
      assert.equal(daily?.attemptsCount, 1, 'oversized input must be rejected before consuming quota');
    });

    it('maps a full global queue to a retryable service error without auditing or consuming daily quota', async () => {
      dailyRepo.admitAttemptAtomic = async () => ({ success: false, reason: 'capacity_exceeded' });
      const submitUseCase = new SubmitAnalysisUseCase(dailyRepo, auditRepo, 'America/Mexico_City', 5);
      await assert.rejects(
        () => submitUseCase.execute({ userId: 'user-capacity', input: 'https://queue-full.example.test/' }),
        AnalysisQueueCapacityExceededError
      );
      assert.equal(dailyRepo.records.length, 0);
      assert.equal(auditRepo.events.length, 0);
    });
  });
});
