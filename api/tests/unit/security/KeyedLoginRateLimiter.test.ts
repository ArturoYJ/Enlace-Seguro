import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ILoginRateLimitRepository } from '../../../src/core/ports/ILoginRateLimitRepository.js';
import { KeyedLoginRateLimiter } from '../../../src/infrastructure/security/KeyedLoginRateLimiter.js';
import { LoginRateLimitUnavailableError, RateLimitExceededError } from '../../../src/core/errors/DomainErrors.js';

class MemoryRateLimitRepository implements ILoginRateLimitRepository {
  public readonly events = new Map<string, Date[]>();
  public fail = false;

  public async getRecentEvents(bucketId: string, since: Date): Promise<Date[]> {
    this.throwIfUnavailable();
    return (this.events.get(bucketId) ?? []).filter((event) => event > since);
  }

  public async tryRecordEvent(bucketId: string, occurredAt: Date, since: Date, _expiresAt: Date, maxEvents: number): Promise<boolean> {
    this.throwIfUnavailable();
    const active = (this.events.get(bucketId) ?? []).filter((event) => event > since);
    if (active.length >= maxEvents) return false;
    active.push(occurredAt);
    this.events.set(bucketId, active);
    return true;
  }

  public async deleteBucket(bucketId: string): Promise<void> {
    this.throwIfUnavailable();
    this.events.delete(bucketId);
  }

  private throwIfUnavailable(): void {
    if (this.fail) throw new Error('database unavailable');
  }
}

describe('KeyedLoginRateLimiter', () => {
  const now = new Date('2026-11-03T18:00:00.000Z');

  it('limits IP attempts and persists only a keyed HMAC identifier', async () => {
    const repository = new MemoryRateLimitRepository();
    const limiter = new KeyedLoginRateLimiter(repository, 'x'.repeat(48));

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await limiter.consumeIpAttempt('203.0.113.17', now);
    }
    await assert.rejects(limiter.consumeIpAttempt('203.0.113.17', now), RateLimitExceededError);

    const [bucketId] = repository.events.keys();
    assert.match(bucketId ?? '', /^v1:[a-f0-9]{64}$/);
    assert.equal(repository.events.has('203.0.113.17'), false);
  });

  it('blocks after ten account failures and clears the account window on successful login', async () => {
    const repository = new MemoryRateLimitRepository();
    const limiter = new KeyedLoginRateLimiter(repository, 'x'.repeat(48));

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await limiter.consumeAccountAttempt(' Person@Example.com ', now);
    }
    await assert.rejects(limiter.consumeAccountAttempt('person@example.com', now), RateLimitExceededError);

    await limiter.clearAccountFailures('person@example.com');
    await limiter.consumeAccountAttempt('person@example.com', now);
  });

  it('fails closed with a generic service error if shared storage is unavailable', async () => {
    const repository = new MemoryRateLimitRepository();
    repository.fail = true;
    const limiter = new KeyedLoginRateLimiter(repository, 'x'.repeat(48));

    await assert.rejects(limiter.consumeIpAttempt('203.0.113.17', now), LoginRateLimitUnavailableError);
  });
});
