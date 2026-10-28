import { IUserRepository, CreateUserData } from '../../src/core/ports/IUserRepository.js';
import { IRefreshTokenRepository, CreateRefreshTokenData } from '../../src/core/ports/IRefreshTokenRepository.js';
import { ISecurityAuditRepository, RecordAuditEventData, ListAuditEventsFilter, PaginatedAuditEventsResult } from '../../src/core/ports/ISecurityAuditRepository.js';
import { IDailyAnalysisRepository, AdmissionResult, ListUserAttemptsOptions, PaginatedAttemptsResult, AdminMetricsResult } from '../../src/core/ports/IDailyAnalysisRepository.js';
import { IPasswordHasher } from '../../src/core/ports/ISecurityServices.js';
import { User } from '../../src/core/entities/User.js';
import { RefreshToken } from '../../src/core/entities/RefreshToken.js';
import { DailyAnalysis, AttemptProps } from '../../src/core/entities/Analysis.js';
import { SecurityAuditEvent } from '../../src/core/entities/SecurityAuditEvent.js';

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
    Object.assign(attempt, updates);
    return true;
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
}

export class MockPasswordHasher implements IPasswordHasher {
  public async hash(password: string): Promise<string> {
    return `hashed_${password}`;
  }

  public async compare(password: string, hash: string): Promise<boolean> {
    return hash === `hashed_${password}`;
  }
}
