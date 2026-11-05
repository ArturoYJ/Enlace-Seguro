import { DailyAnalysis, AttemptProps } from '../entities/Analysis.js';

export interface AdmissionResult {
  success: boolean;
  attempt?: AttemptProps;
  reason?: 'quota_exceeded' | 'duplicate_attempt_id' | 'capacity_exceeded';
}

export interface ListUserAttemptsOptions {
  limit: number;
  cursor?: string;
  startDate?: string;
  endDate?: string;
}

export interface PaginatedAttemptsResult {
  items: Array<AttemptProps & { localDate: string }>;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface AdminMetricsResult {
  dateRange: { startDate: string; endDate: string };
  totalAttempts: number;
  byStatus: Record<string, number>;
  byVerdict: Record<string, number>;
}

export interface UserAnalysisSummaryCounts {
  total: number;
  dangerous: number;
  suspicious: number;
}

/** Low-cardinality operational view of durable work; it never includes attempt or user identifiers. */
export interface AnalysisQueueSnapshot {
  pendingCount: number;
  maxPending: number;
  queuedCount: number;
  leasedCount: number;
  expiredLeaseCount: number;
  retryingCount: number;
  deadCount: number;
  oldestPendingAgeMs: number | null;
}

/** A job claimed from MongoDB. The raw submitted URL is hydrated only inside the trusted API worker. */
export interface ClaimedAnalysisJob {
  userId: string;
  localDate: string;
  attemptId: string;
  leaseToken: string;
  attemptNumber: number;
  targetUrl: string;
  /** Already terminalized after repeated worker crashes; this synthetic claim exists only to audit it. */
  leaseExhausted?: boolean;
}

export type RetryClaimResult = 'rescheduled' | 'exhausted' | 'stale';

export interface IDailyAnalysisRepository {
  admitAttemptAtomic(
    userId: string,
    localDate: string,
    attempt: AttemptProps,
    maxAttempts?: number
  ): Promise<AdmissionResult>;

  updateAttempt(
    userId: string,
    localDate: string,
    attemptId: string,
    updates: Partial<AttemptProps>
  ): Promise<boolean>;

  claimNextAnalysisJob(workerId: string, now: Date, leaseDurationMs: number, maxAttempts?: number): Promise<ClaimedAnalysisJob | null>;

  completeClaimedAnalysisJob(
    job: ClaimedAnalysisJob,
    completedAt: Date,
    analysis: AttemptProps['analysis']
  ): Promise<boolean>;

  retryClaimedAnalysisJob(
    job: ClaimedAnalysisJob,
    now: Date,
    nextAttemptAt: Date,
    reasonCode: string,
    maxAttempts: number
  ): Promise<RetryClaimResult>;

  getAnalysisQueueSnapshot(now: Date): Promise<AnalysisQueueSnapshot>;

  failClaimedAnalysisJob(
    job: ClaimedAnalysisJob,
    completedAt: Date,
    status: 'failed' | 'inconclusive',
    reasonCode: string
  ): Promise<boolean>;

  findDailyAnalysis(userId: string, localDate: string): Promise<DailyAnalysis | null>;

  findAttemptByLocalKey(
    userId: string,
    localDate: string,
    attemptId: string
  ): Promise<{ dailyAnalysis: DailyAnalysis; attempt: AttemptProps } | null>;

  findAttemptGlobally(
    attemptId: string
  ): Promise<{ dailyAnalysis: DailyAnalysis; attempt: AttemptProps } | null>;

  listUserAttempts(userId: string, options: ListUserAttemptsOptions): Promise<PaginatedAttemptsResult>;

  getUserAnalysisSummary(userId: string, startsAtInclusive: Date, endsAtExclusive: Date): Promise<UserAnalysisSummaryCounts>;

  getMetrics(startDate: string, endDate: string): Promise<AdminMetricsResult>;
}
