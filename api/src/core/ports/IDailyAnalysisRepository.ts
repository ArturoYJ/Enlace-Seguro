import { DailyAnalysis, AttemptProps } from '../entities/Analysis.js';

export interface AdmissionResult {
  success: boolean;
  attempt?: AttemptProps;
  reason?: 'quota_exceeded' | 'duplicate_attempt_id';
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

  getMetrics(startDate: string, endDate: string): Promise<AdminMetricsResult>;
}
