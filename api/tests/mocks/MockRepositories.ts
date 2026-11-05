import { IUserRepository, CreateUserData } from '../../src/core/ports/IUserRepository.js';
import { IRefreshTokenRepository, CreateRefreshTokenData } from '../../src/core/ports/IRefreshTokenRepository.js';
import { ISecurityAuditRepository, RecordAuditEventData, ListAuditEventsFilter, PaginatedAuditEventsResult } from '../../src/core/ports/ISecurityAuditRepository.js';
import { IDailyAnalysisRepository, AdmissionResult, ListUserAttemptsOptions, PaginatedAttemptsResult, AdminMetricsResult, UserAnalysisSummaryCounts, AnalysisQueueSnapshot, ClaimedAnalysisJob, RetryClaimResult } from '../../src/core/ports/IDailyAnalysisRepository.js';
import { IPasswordHasher } from '../../src/core/ports/ISecurityServices.js';
import { User } from '../../src/core/entities/User.js';
import { RefreshToken } from '../../src/core/entities/RefreshToken.js';
import { DailyAnalysis, AttemptProps } from '../../src/core/entities/Analysis.js';
import { SecurityAuditEvent } from '../../src/core/entities/SecurityAuditEvent.js';
import { ILoginRateLimiter } from '../../src/core/ports/ILoginRateLimiter.js';

export class MockUserRepository implements IUserRepository {
  public users: User[] = [];

  public async findById(id: string): Promise<User | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }

  public async findByEmail(emailNormalized: string): Promise<User | null> {
    return this.users.find((u) => u.emailNormalized === emailNormalized) ?? null;
  }

  public async create(data: CreateUserData): Promise<User> {
    const user = new User({
      id: `user-${this.users.length + 1}`,
      emailNormalized: data.emailNormalized,
      passwordHash: data.passwordHash,
      role: data.role,
      accountStatus: data.accountStatus,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    this.users.push(user);
    return user;
  }

  public async countAdmins(): Promise<number> {
    return this.users.filter((u) => u.role === 'admin').length;
  }
}

export class MockRefreshTokenRepository implements IRefreshTokenRepository {
  public tokens: RefreshToken[] = [];

  public async create(data: CreateRefreshTokenData): Promise<RefreshToken> {
    const token = new RefreshToken({
      id: `token-${this.tokens.length + 1}`,
      userId: data.userId,
      tokenHash: data.tokenHash,
      familyId: data.familyId,
      isRevoked: data.isRevoked,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt
    });
    this.tokens.push(token);
    return token;
  }

  public async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.tokens.find((t) => t.tokenHash === tokenHash) ?? null;
  }

  public async revokeById(id: string): Promise<void> {
    const token = this.tokens.find((t) => t.id === id);
    if (token) {
      (token as unknown as { isRevoked: boolean }).isRevoked = true;
    }
  }

  public async revokeByFamilyId(familyId: string): Promise<number> {
    let count = 0;
    for (const t of this.tokens) {
      if (t.familyId === familyId) {
        (t as unknown as { isRevoked: boolean }).isRevoked = true;
        count++;
      }
    }
    return count;
  }

  public async revokeAllByUserId(userId: string): Promise<number> {
    let count = 0;
    for (const t of this.tokens) {
      if (t.userId === userId) {
        (t as unknown as { isRevoked: boolean }).isRevoked = true;
        count++;
      }
    }
    return count;
  }
}

export class MockSecurityAuditRepository implements ISecurityAuditRepository {
  public events: SecurityAuditEvent[] = [];

  public async record(data: RecordAuditEventData): Promise<SecurityAuditEvent> {
    const event = new SecurityAuditEvent({
      id: `audit-${this.events.length + 1}`,
      occurredAt: data.occurredAt,
      purgeAt: data.purgeAt,
      eventType: data.eventType,
      actorType: data.actorType,
      actorId: data.actorId,
      action: data.action,
      outcome: data.outcome,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      requestId: data.requestId,
      metadata: data.metadata
    });
    this.events.push(event);
    return event;
  }

  public async listEvents(_filter: ListAuditEventsFilter): Promise<PaginatedAuditEventsResult> {
    return {
      items: this.events,
      hasMore: false,
      nextCursor: null
    };
  }
}

export class MockDailyAnalysisRepository implements IDailyAnalysisRepository {
  public records: DailyAnalysis[] = [];
  private readonly jobStates = new Map<string, { state: 'queued' | 'leased' | 'completed' | 'dead'; attemptCount: number; availableAt: Date; leaseToken?: string; leaseExpiresAt?: Date }>();

  public async admitAttemptAtomic(
    userId: string,
    localDate: string,
    attempt: AttemptProps,
    maxAttempts = 5
  ): Promise<AdmissionResult> {
    let daily = this.records.find((r) => r.userId === userId && r.localDate === localDate);
    if (!daily) {
      daily = new DailyAnalysis({
        id: `daily-${this.records.length + 1}`,
        userId,
        localDate,
        attempts: [],
        purgeAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      });
      this.records.push(daily);
    }

    if (daily.attempts.length >= maxAttempts) {
      return { success: false, reason: 'quota_exceeded' };
    }

    if (daily.attempts.some((a) => a.attemptId === attempt.attemptId)) {
      return { success: false, reason: 'duplicate_attempt_id' };
    }

    daily.attempts.push(attempt);
    this.jobStates.set(attempt.attemptId, { state: 'queued', attemptCount: 0, availableAt: attempt.receivedAt });
    return { success: true, attempt };
  }

  public async updateAttempt(
    userId: string,
    localDate: string,
    attemptId: string,
    updates: Partial<AttemptProps>
  ): Promise<boolean> {
    const daily = this.records.find((r) => r.userId === userId && r.localDate === localDate);
    if (!daily) return false;
    const attempt = daily.attempts.find((a) => a.attemptId === attemptId);
    if (!attempt) return false;
    if (updates.processingStatus !== undefined) {
      const expectedStatus = updates.processingStatus === 'processing' || updates.processingStatus === 'validation_failed'
        ? 'received'
        : updates.processingStatus === 'received'
          ? null
          : 'processing';
      if (attempt.processingStatus !== expectedStatus) return false;
    }
    Object.assign(attempt, updates);
    return true;
  }

  public async claimNextAnalysisJob(workerId: string, now: Date, leaseDurationMs: number, _maxAttempts = 10): Promise<ClaimedAnalysisJob | null> {
    for (const daily of this.records) {
      for (const attempt of daily.attempts) {
        const queue = this.jobStates.get(attempt.attemptId);
        if (!queue || queue.availableAt > now || attempt.processingStatus === 'completed' || attempt.processingStatus === 'failed' || attempt.processingStatus === 'inconclusive') continue;
        if (queue.state === 'leased' && queue.leaseExpiresAt && queue.leaseExpiresAt > now) continue;
        const leaseToken = `lease-${Math.random()}`;
        queue.state = 'leased';
        queue.attemptCount += 1;
        queue.leaseToken = leaseToken;
        queue.leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
        attempt.processingStatus = 'processing';
        attempt.updatedAt = now;
        if (!attempt.submittedInput) return null;
        return { userId: daily.userId, localDate: daily.localDate, attemptId: attempt.attemptId, leaseToken, attemptNumber: queue.attemptCount, targetUrl: attempt.submittedInput };
      }
    }
    return null;
  }

  private getClaim(job: ClaimedAnalysisJob) {
    const daily = this.records.find((record) => record.userId === job.userId && record.localDate === job.localDate);
    const attempt = daily?.attempts.find((item) => item.attemptId === job.attemptId);
    const queue = this.jobStates.get(job.attemptId);
    if (!daily || !attempt || !queue || queue.leaseToken !== job.leaseToken || attempt.processingStatus !== 'processing') return null;
    return { daily, attempt, queue };
  }

  public async completeClaimedAnalysisJob(job: ClaimedAnalysisJob, completedAt: Date, analysis: AttemptProps['analysis']): Promise<boolean> {
    const claim = this.getClaim(job);
    if (!claim || !analysis) return false;
    claim.attempt.processingStatus = 'completed';
    claim.attempt.updatedAt = completedAt;
    claim.attempt.completedAt = completedAt;
    claim.attempt.analysis = analysis;
    claim.queue.state = 'completed';
    delete claim.queue.leaseToken;
    return true;
  }

  public async retryClaimedAnalysisJob(job: ClaimedAnalysisJob, now: Date, nextAttemptAt: Date, _reasonCode: string, maxAttempts: number): Promise<RetryClaimResult> {
    const claim = this.getClaim(job);
    if (!claim) return 'stale';
    if (job.attemptNumber >= maxAttempts) {
      await this.failClaimedAnalysisJob(job, now, 'failed', 'retry_exhausted');
      return 'exhausted';
    }
    claim.queue.state = 'queued';
    claim.queue.availableAt = nextAttemptAt;
    claim.attempt.updatedAt = now;
    delete claim.queue.leaseToken;
    delete claim.queue.leaseExpiresAt;
    return 'rescheduled';
  }

  public async failClaimedAnalysisJob(job: ClaimedAnalysisJob, completedAt: Date, status: 'failed' | 'inconclusive', _reasonCode: string): Promise<boolean> {
    const claim = this.getClaim(job);
    if (!claim) return false;
    claim.attempt.processingStatus = status;
    claim.attempt.updatedAt = completedAt;
    claim.attempt.completedAt = completedAt;
    claim.queue.state = 'dead';
    delete claim.queue.leaseToken;
    return true;
  }

  public async getAnalysisQueueSnapshot(now: Date): Promise<AnalysisQueueSnapshot> {
    const jobs = [...this.jobStates.entries()];
    const active = jobs.filter(([, job]) => job.state === 'queued' || job.state === 'leased');
    const pendingDates = this.records.flatMap((daily) => daily.attempts
      .filter((attempt) => active.some(([attemptId]) => attemptId === attempt.attemptId))
      .map((attempt) => attempt.receivedAt.getTime()));
    return {
      pendingCount: active.length,
      maxPending: 1000,
      queuedCount: active.filter(([, job]) => job.state === 'queued').length,
      leasedCount: active.filter(([, job]) => job.state === 'leased').length,
      expiredLeaseCount: active.filter(([, job]) => job.state === 'leased' && job.leaseExpiresAt !== undefined && job.leaseExpiresAt <= now).length,
      retryingCount: active.filter(([, job]) => job.attemptCount > 1).length,
      deadCount: jobs.filter(([, job]) => job.state === 'dead').length,
      oldestPendingAgeMs: pendingDates.length ? Math.max(0, now.getTime() - Math.min(...pendingDates)) : null
    };
  }

  public async findDailyAnalysis(userId: string, localDate: string): Promise<DailyAnalysis | null> {
    return this.records.find((r) => r.userId === userId && r.localDate === localDate) ?? null;
  }

  public async findAttemptByLocalKey(
    userId: string,
    localDate: string,
    attemptId: string
  ): Promise<{ dailyAnalysis: DailyAnalysis; attempt: AttemptProps } | null> {
    const daily = this.records.find((r) => r.userId === userId && r.localDate === localDate);
    if (!daily) return null;
    const attempt = daily.attempts.find((a) => a.attemptId === attemptId);
    if (!attempt) return null;
    return { dailyAnalysis: daily, attempt };
  }

  public async findAttemptGlobally(
    attemptId: string
  ): Promise<{ dailyAnalysis: DailyAnalysis; attempt: AttemptProps } | null> {
    for (const daily of this.records) {
      const attempt = daily.attempts.find((a) => a.attemptId === attemptId);
      if (attempt) return { dailyAnalysis: daily, attempt };
    }
    return null;
  }

  public async listUserAttempts(
    userId: string,
    _options: ListUserAttemptsOptions
  ): Promise<PaginatedAttemptsResult> {
    const userDailies = this.records.filter((r) => r.userId === userId);
    const items = userDailies.flatMap((d) => d.attempts.map((a) => ({ ...a, localDate: d.localDate })));
    return {
      items,
      hasMore: false,
      nextCursor: null
    };
  }

  public async getMetrics(startDate: string, endDate: string): Promise<AdminMetricsResult> {
    return {
      dateRange: { startDate, endDate },
      totalAttempts: 0,
      byStatus: {},
      byVerdict: {}
    };
  }

  public async getUserAnalysisSummary(
    _userId: string,
    _startsAtInclusive: Date,
    _endsAtExclusive: Date
  ): Promise<UserAnalysisSummaryCounts> {
    return { total: 0, dangerous: 0, suspicious: 0 };
  }
}

export class MockPasswordHasher implements IPasswordHasher {
  public async hash(password: string): Promise<string> {
    return `hashed_${password}`;
  }

  public async compare(password: string, hash: string): Promise<boolean> {
    return hash === `hashed_${password}`;
  }
}

export class MockLoginRateLimiter implements ILoginRateLimiter {
  public ipAttempts: string[] = [];
  public accountFailures: string[] = [];
  public checkedAccounts: string[] = [];
  public clearedAccounts: string[] = [];
  public blockedIp = false;
  public blockedAccount = false;
  public unavailable = false;

  public async consumeIpAttempt(sourceIp: string): Promise<void> {
    if (this.unavailable) throw new Error('Rate limit storage unavailable');
    if (this.blockedIp) throw new Error('Rate limited');
    this.ipAttempts.push(sourceIp);
  }

  public async consumeAccountAttempt(emailNormalized: string): Promise<void> {
    if (this.unavailable) throw new Error('Rate limit storage unavailable');
    if (this.blockedAccount) throw new Error('Rate limited');
    this.checkedAccounts.push(emailNormalized);
    this.accountFailures.push(emailNormalized);
  }

  public async clearAccountFailures(emailNormalized: string): Promise<void> {
    if (this.unavailable) throw new Error('Rate limit storage unavailable');
    this.clearedAccounts.push(emailNormalized);
  }
}
