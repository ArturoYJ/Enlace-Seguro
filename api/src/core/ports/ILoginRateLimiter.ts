export interface ILoginRateLimiter {
  consumeIpAttempt(sourceIp: string, now: Date): Promise<void>;
  consumeAccountAttempt(emailNormalized: string, now: Date): Promise<void>;
  clearAccountFailures(emailNormalized: string): Promise<void>;
}
