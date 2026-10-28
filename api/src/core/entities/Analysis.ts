export type ProcessingStatus =
  | 'received'
  | 'validation_failed'
  | 'processing'
  | 'completed'
  | 'inconclusive'
  | 'failed';

export type Verdict = 'peligroso' | 'sospechoso' | 'sin_amenazas_detectadas';

export interface SourceResult {
  sourceName: string;
  status: string;
  checkedAt: Date;
  expiresAt: Date;
  resultCode?: string;
  summary?: string;
}

export interface SourceFailure {
  sourceName: string;
  reasonCode: string;
}

export interface AnalysisPayload {
  verdict: Verdict;
  reasons: string[];
  finalDestination: string;
  sourceResults: SourceResult[];
  sourceFailures: SourceFailure[];
  signals: string[];
  redirects: string[];
  screenshotRef?: string;
}

export interface AttemptProps {
  attemptId: string;
  receivedAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  processingStatus: ProcessingStatus;
  submittedInput?: string;
  inputDigest: string;
  inputSizeBytes: number;
  analysis?: AnalysisPayload;
}

export interface DailyAnalysisProps {
  id: string;
  userId: string;
  localDate: string; // YYYY-MM-DD in America/Mexico_City
  attempts: AttemptProps[];
  purgeAt: Date;
}

export class DailyAnalysis {
  public readonly id: string;
  public readonly userId: string;
  public readonly localDate: string;
  public readonly attempts: AttemptProps[];
  public readonly purgeAt: Date;

  constructor(props: DailyAnalysisProps) {
    this.id = props.id;
    this.userId = props.userId;
    this.localDate = props.localDate;
    this.attempts = props.attempts;
    this.purgeAt = props.purgeAt;
  }

  public get attemptsCount(): number {
    return this.attempts.length;
  }

  public hasReachedDailyQuota(maxLimit = 5): boolean {
    return this.attempts.length >= maxLimit;
  }

  public findAttempt(attemptId: string): AttemptProps | undefined {
    return this.attempts.find((a) => a.attemptId === attemptId);
  }
}
