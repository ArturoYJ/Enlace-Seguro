import { createHmac } from 'node:crypto';
import { LoginRateLimitUnavailableError, RateLimitExceededError } from '../../core/errors/DomainErrors.js';
import { ILoginRateLimitRepository } from '../../core/ports/ILoginRateLimitRepository.js';
import { ILoginRateLimiter } from '../../core/ports/ILoginRateLimiter.js';

export const DEFAULT_LOGIN_RATE_LIMIT_POLICY = {
  ip: { maxEvents: 20, windowMs: 60_000 },
  account: { maxEvents: 10, windowMs: 15 * 60_000 }
} as const;

export class KeyedLoginRateLimiter implements ILoginRateLimiter {
  constructor(
    private readonly repository: ILoginRateLimitRepository,
    private readonly hmacKey: string,
    private readonly policy = DEFAULT_LOGIN_RATE_LIMIT_POLICY
  ) {
    if (Buffer.byteLength(hmacKey, 'utf8') < 32 || /\s/.test(hmacKey)) {
      throw new Error('LOGIN_RATE_LIMIT_HMAC_KEY must contain at least 32 UTF-8 bytes and no whitespace.');
    }
  }

  public async consumeIpAttempt(sourceIp: string, now: Date): Promise<void> {
    const bucketId = this.bucketId('ip', sourceIp);
    const policy = this.policy.ip;
    const cutoff = new Date(now.getTime() - policy.windowMs);
    try {
      const accepted = await this.repository.tryRecordEvent(
        bucketId,
        now,
        cutoff,
        new Date(now.getTime() + policy.windowMs),
        policy.maxEvents
      );
      if (accepted) return;
      const recent = await this.repository.getRecentEvents(bucketId, cutoff);
      throw this.rateLimitError(recent, policy.windowMs, now);
    } catch (cause) {
      if (cause instanceof RateLimitExceededError) throw cause;
      throw new LoginRateLimitUnavailableError();
    }
  }

  public async consumeAccountAttempt(emailNormalized: string, now: Date): Promise<void> {
    const policy = this.policy.account;
    const cutoff = new Date(now.getTime() - policy.windowMs);
    try {
      const bucketId = this.bucketId('account', emailNormalized);
      const accepted = await this.repository.tryRecordEvent(
        bucketId,
        now,
        cutoff,
        new Date(now.getTime() + policy.windowMs),
        policy.maxEvents
      );
      if (accepted) return;
      const recent = await this.repository.getRecentEvents(bucketId, cutoff);
      throw this.rateLimitError(recent, policy.windowMs, now);
    } catch (cause) {
      if (cause instanceof RateLimitExceededError) throw cause;
      throw new LoginRateLimitUnavailableError();
    }
  }

  public async clearAccountFailures(emailNormalized: string): Promise<void> {
    try {
      await this.repository.deleteBucket(this.bucketId('account', emailNormalized));
    } catch {
      throw new LoginRateLimitUnavailableError();
    }
  }

  private bucketId(scope: 'ip' | 'account', identifier: string): string {
    const normalized = scope === 'account' ? identifier.trim().toLowerCase() : identifier.trim();
    const digest = createHmac('sha256', this.hmacKey)
      .update(`enlaceseguro-login-rate:v1:${scope}:${normalized}`)
      .digest('hex');
    return `v1:${digest}`;
  }

  private rateLimitError(events: Date[], windowMs: number, now: Date): RateLimitExceededError {
    const earliest = events.reduce((value, event) => Math.min(value, event.getTime()), now.getTime());
    const retryAfterSeconds = Math.max(1, Math.ceil((earliest + windowMs - now.getTime()) / 1000));
    return new RateLimitExceededError(retryAfterSeconds);
  }
}
