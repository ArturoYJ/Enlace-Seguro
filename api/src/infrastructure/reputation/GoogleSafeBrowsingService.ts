import { IReputationService, ReputationCheck } from '../../core/ports/IReputationService.js';

const SOURCE_NAME = 'google_safe_browsing';
const ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'];
const CLEAN_CACHE_MS = 5 * 60 * 1000;

const THREAT_LABELS: Record<string, string> = {
  MALWARE: 'software malicioso',
  SOCIAL_ENGINEERING: 'phishing o engaño',
  UNWANTED_SOFTWARE: 'software no deseado',
  POTENTIALLY_HARMFUL_APPLICATION: 'aplicaciones dañinas'
};

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface GoogleSafeBrowsingOptions {
  apiKey: string;
  timeoutMs?: number;
  clientVersion?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export function describeThreatTypes(threatTypes: string[]): string {
  return threatTypes.map((t) => THREAT_LABELS[t] ?? t.toLowerCase()).join(', ');
}

/**
 * Adaptador de la Lookup API v4 de Google Safe Browsing (threatMatches.find).
 * Envía la URL a Google y recibe las coincidencias con sus listas de amenazas.
 * Uso no comercial, acorde con los términos de la Lookup API.
 */
export class GoogleSafeBrowsingService implements IReputationService {
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly clientVersion: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(options: GoogleSafeBrowsingOptions) {
    if (!options.apiKey || /\s/.test(options.apiKey)) {
      throw new Error('GOOGLE_SAFE_BROWSING_API_KEY must be a non-empty value without whitespace.');
    }
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.clientVersion = options.clientVersion ?? '1.0.0';
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
    this.now = options.now ?? (() => new Date());
  }

  public async check(urls: string[]): Promise<ReputationCheck> {
    const entries = [...new Set(urls.filter((u) => typeof u === 'string' && u.length > 0 && u.length <= 8192))].slice(0, 10);
    if (entries.length === 0) {
      return { status: 'unavailable', failure: { sourceName: SOURCE_NAME, reasonCode: 'no_urls' } };
    }

    let data: unknown;
    try {
      const response = await this.fetchImpl(`${ENDPOINT}?key=${encodeURIComponent(this.apiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'enlaceseguro', clientVersion: this.clientVersion },
          threatInfo: {
            threatTypes: THREAT_TYPES,
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: entries.map((url) => ({ url }))
          }
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!response.ok) {
        // No se incluye el cuerpo de la respuesta: puede repetir la URL consultada o la clave.
        return { status: 'unavailable', failure: { sourceName: SOURCE_NAME, reasonCode: `http_${response.status}` } };
      }
      data = await response.json();
    } catch (err: unknown) {
      const reasonCode = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'timeout' : 'network_error';
      return { status: 'unavailable', failure: { sourceName: SOURCE_NAME, reasonCode } };
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { status: 'unavailable', failure: { sourceName: SOURCE_NAME, reasonCode: 'invalid_response' } };
    }

    const checkedAt = this.now();
    const matches = (data as { matches?: unknown }).matches;
    if (matches === undefined) {
      return {
        status: 'clean',
        sourceResult: { sourceName: SOURCE_NAME, status: 'clean', checkedAt, expiresAt: new Date(checkedAt.getTime() + CLEAN_CACHE_MS) }
      };
    }
    if (!Array.isArray(matches)) {
      return { status: 'unavailable', failure: { sourceName: SOURCE_NAME, reasonCode: 'invalid_response' } };
    }

    const threatTypes = [...new Set(matches
      .map((m) => (m && typeof m === 'object' ? (m as { threatType?: unknown }).threatType : undefined))
      .filter((t): t is string => typeof t === 'string' && THREAT_TYPES.includes(t)))];
    if (threatTypes.length === 0) {
      return { status: 'unavailable', failure: { sourceName: SOURCE_NAME, reasonCode: 'invalid_response' } };
    }

    const cacheSeconds = matches
      .map((m) => Number.parseFloat(String((m as { cacheDuration?: unknown }).cacheDuration ?? '').replace(/s$/, '')))
      .filter((n) => Number.isFinite(n) && n > 0);
    const ttlMs = (cacheSeconds.length > 0 ? Math.min(...cacheSeconds) : 300) * 1000;

    return {
      status: 'listed',
      threatTypes,
      sourceResult: {
        sourceName: SOURCE_NAME,
        status: 'listed',
        checkedAt,
        expiresAt: new Date(checkedAt.getTime() + ttlMs),
        resultCode: threatTypes.join(',').slice(0, 128),
        summary: `Listado por Google Safe Browsing como ${describeThreatTypes(threatTypes)}.`
      }
    };
  }
}
