import { isIP } from 'node:net';
import { createHmac } from 'node:crypto';
import type { IReputationProvider, IReputationQuota, ReputationResult } from '../../core/ports/IReputationProvider.js';

const ENDPOINT = 'https://www.virustotal.com/api/v3/urls/';
const DOMAIN_ENDPOINT = 'https://www.virustotal.com/api/v3/domains/';
// VirusTotal empezó a operar en 2004; una fecha anterior indica un informe mal formado.
const MIN_REPORT_TIME = Date.UTC(2004, 0, 1);
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

/**
 * Modo dominio: para enlaces fuera de la lista solo se envía el nombre del dominio (sin ruta,
 * parámetros ni fragmento), que es donde casi nunca hay datos personales del usuario.
 */
function lookupDomain(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!host.includes('.') || isIP(host.replace(/^\[|\]$/g, '')) || host === 'localhost' ||
      host.endsWith('.localhost') || host.endsWith('.local')) return null;
    return host;
  } catch { return null; }
}

export class VirusTotalReputationProvider implements IReputationProvider {
  private readonly cache = new Map<string, { result: CompletedReputation; expiresAt: number }>();
  constructor(
    private readonly apiKey: string,
    private readonly allowlist: ReadonlySet<string>,
    private readonly quota: IReputationQuota,
    private readonly request: typeof fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
    private readonly timeoutMs = 5_000,
    private readonly domainLookup = false
  ) {
    if (!apiKey || /\s/.test(apiKey)) throw new Error('VirusTotal API key is invalid.');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw new Error('Invalid reputation timeout.');
  }

  async check(url: string): Promise<ReputationResult> {
    let scope: 'url' | 'domain';
    let target: string;
    if (approvedUrl(url, this.allowlist)) { scope = 'url'; target = url; }
    else {
      const domain = this.domainLookup ? lookupDomain(url) : null;
      if (!domain) return { status: 'not_queried' };
      scope = 'domain'; target = domain;
    }
    const cacheKey = createHmac('sha256', this.apiKey).update(`${scope}:${target}`).digest('hex');
    const cached = this.cache.get(cacheKey);
    const now = this.clock().getTime();
    if (cached && now >= cached.result.checkedAt.getTime() && now < cached.expiresAt) return { ...cached.result };
    if (cached) this.cache.delete(cacheKey);
    try {
      if (!await this.quota.reserve()) return { status: 'rate_limited' };
    } catch { return { status: 'error' }; }
    const checkedAt = this.clock();
    try {
      const endpoint = scope === 'url'
        ? `${ENDPOINT}${Buffer.from(target, 'utf8').toString('base64url')}`
        : `${DOMAIN_ENDPOINT}${encodeURIComponent(target)}`;
      const response = await this.request(endpoint, {
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
      // Un informe de hace días sigue siendo útil (casi todo el phishing conocido tiene informes
      // viejos); se muestra con su fecha en lugar de descartarlo.
      const reportAt = new Date(seconds * 1000);
      if (Number.isNaN(reportAt.getTime()) || reportAt.getTime() < MIN_REPORT_TIME) {
        return { status: 'error', checkedAt };
      }
      const result: CompletedReputation = {
        status: malicious > 0 ? 'match' : 'no_match', checkedAt, reportAt, malicious, scope,
        ...(scope === 'domain' ? { domain: target } : {})
      };
      const expiresAt = checkedAt.getTime() + CACHE_TTL_MS;
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
