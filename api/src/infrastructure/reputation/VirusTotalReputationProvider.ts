import { isIP } from 'node:net';
import { createHmac } from 'node:crypto';
import type { IReputationProvider, IReputationQuota, ReputationResult } from '../../core/ports/IReputationProvider.js';

const ENDPOINT = 'https://www.virustotal.com/api/v3/urls/';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;
type CompletedReputation = Extract<ReputationResult, { status: 'match' | 'no_match' }>;

/** The exact allowlist is a separate safeguard, not proof that a URL has no secrets. */
function approvedUrl(value: string, allowlist: ReadonlySet<string>): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return allowlist.has(value) && (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username && !url.password && !value.includes('?') && !value.includes('#') &&
      !isIP(host) && host !== 'localhost' && !host.endsWith('.localhost') && !host.endsWith('.local');
  } catch { return false; }
}

export class VirusTotalReputationProvider implements IReputationProvider {
  private readonly cache = new Map<string, { result: CompletedReputation; expiresAt: number }>();
  constructor(
    private readonly apiKey: string,
    private readonly allowlist: ReadonlySet<string>,
    private readonly quota: IReputationQuota,
    private readonly request: typeof fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
    private readonly timeoutMs = 5_000
  ) {
    if (!apiKey || /\s/.test(apiKey)) throw new Error('VirusTotal API key is invalid.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw new Error('Invalid reputation timeout.');
  }

  async check(url: string): Promise<ReputationResult> {
    if (!approvedUrl(url, this.allowlist)) return { status: 'not_queried' };
    const cacheKey = createHmac('sha256', this.apiKey).update(url).digest('hex');
    const cached = this.cache.get(cacheKey);
    const now = this.clock().getTime();
    if (cached && now >= cached.result.checkedAt.getTime() && now < cached.expiresAt) return { ...cached.result };
    if (cached) this.cache.delete(cacheKey);
    try {
      if (!await this.quota.reserve()) return { status: 'rate_limited' };
    } catch { return { status: 'error' }; }
    const checkedAt = this.clock();
    try {
      const id = Buffer.from(url, 'utf8').toString('base64url');
      const response = await this.request(`${ENDPOINT}${id}`, {
        method: 'GET', headers: { 'x-apikey': this.apiKey }, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (response.status === 429) {
        try { await this.quota.cooldown(); } catch { return { status: 'error', checkedAt }; }
        return { status: 'rate_limited', checkedAt };
      }
      if (response.status === 404) return { status: 'not_found', checkedAt };
      if (!response.ok) return { status: 'error', checkedAt };
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object') return { status: 'error', checkedAt };
      const attrs = (payload as { data?: { attributes?: { last_analysis_stats?: { malicious?: unknown }; last_analysis_date?: unknown } } }).data?.attributes;
      const malicious = attrs?.last_analysis_stats?.malicious;
      const seconds = attrs?.last_analysis_date;
      if (typeof malicious !== 'number' || !Number.isSafeInteger(malicious) || malicious < 0 ||
          typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds * 1000 > checkedAt.getTime()) {
        return { status: 'error', checkedAt };
      }
      const reportAt = new Date(seconds * 1000);
      if (Number.isNaN(reportAt.getTime()) || checkedAt.getTime() - reportAt.getTime() > 24 * 60 * 60 * 1000) {
        return { status: 'error', checkedAt };
      }
      const result: CompletedReputation = { status: malicious > 0 ? 'match' : 'no_match', checkedAt, reportAt, malicious };
      const expiresAt = Math.min(checkedAt.getTime() + CACHE_TTL_MS, reportAt.getTime() + 24 * 60 * 60 * 1000);
      if (expiresAt > checkedAt.getTime()) {
        if (this.cache.size >= MAX_CACHE_ENTRIES) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(cacheKey, { result, expiresAt });
      }
      return { ...result };
    } catch { return { status: 'error', checkedAt }; }
  }
}
