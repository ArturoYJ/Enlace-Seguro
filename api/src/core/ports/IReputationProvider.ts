export type ReputationResult =
  | { status: 'match' | 'no_match'; checkedAt: Date; reportAt: Date; malicious: number }
  | { status: 'not_found' | 'not_queried' | 'rate_limited' | 'error'; checkedAt?: Date };

export interface IReputationProvider {
  check(url: string): Promise<ReputationResult>;
}

export interface IReputationQuota {
  /** Atomically reserve a request, or fail closed when quota state is unavailable. */
  reserve(): Promise<boolean>;
  /** Make future reservations fail until the shared cooldown has elapsed. */
  cooldown(): Promise<void>;
}
