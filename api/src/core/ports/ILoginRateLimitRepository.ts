export interface ILoginRateLimitRepository {
  getRecentEvents(bucketId: string, since: Date): Promise<Date[]>;
  tryRecordEvent(
    bucketId: string,
    occurredAt: Date,
    since: Date,
    expiresAt: Date,
    maxEvents: number
  ): Promise<boolean>;
  deleteBucket(bucketId: string): Promise<void>;
}
