import { ISandboxService, SandboxAnalysisOutput } from '../../core/ports/ISandboxService.js';
import { SourceResult, Verdict } from '../../core/entities/Analysis.js';
import { SandboxServiceError } from '../../core/errors/DomainErrors.js';
import { isIP } from 'node:net';

const DEFAULT_SANDBOX_SERVICE_URL = 'http://localhost:3001';

/** Resolve the local-only development fallback and fail closed for production. */
export function resolveSandboxServiceUrl(configuredUrl: string | undefined, environment = process.env['NODE_ENV'] ?? 'development'): string {
  if (!configuredUrl) {
    if (environment === 'production') {
      throw new Error('SANDBOX_SERVICE_URL must be explicitly configured as HTTPS in production.');
    }
    return DEFAULT_SANDBOX_SERVICE_URL;
  }
  return validateSandboxServiceUrl(configuredUrl, environment);
}

export function validateSandboxServiceUrl(baseUrl: string, environment = process.env['NODE_ENV'] ?? 'development'): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('SANDBOX_SERVICE_URL must be an absolute HTTP(S) URL.');
  }

  const authority = baseUrl.match(/^[A-Za-z][A-Za-z\d+.-]*:\/\/([^/?#]*)/)?.[1] ?? '';
  if (!['http:', 'https:'].includes(parsed.protocol) || authority.includes('@') || parsed.username || parsed.password ||
    baseUrl.includes('?') || baseUrl.includes('#')) {
    throw new Error('SANDBOX_SERVICE_URL must use HTTP(S) without credentials, query, or fragment.');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLoopback = hostname === 'localhost' || hostname === '::1' ||
    (isIP(hostname) === 4 && Number(hostname.split('.')[0]) === 127);
  if (parsed.protocol === 'http:' && (environment === 'production' || !isLoopback)) {
    throw new Error('SANDBOX_SERVICE_URL must use HTTPS except for loopback HTTP in non-production environments.');
  }

  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  return parsed.toString().replace(/\/$/, '');
}

export class HttpSandboxService implements ISandboxService {
  constructor(
    baseUrl: string,
    private readonly serviceToken: string,
    private readonly analysisTimeoutMs = 30_000
  ) {
    this.baseUrl = validateSandboxServiceUrl(baseUrl);
    if (Buffer.byteLength(serviceToken, 'utf8') < 32 || /\s/.test(serviceToken)) {
      throw new Error('SANDBOX_SERVICE_TOKEN must contain at least 32 UTF-8 bytes and no whitespace.');
    }
    if (!Number.isInteger(analysisTimeoutMs) || analysisTimeoutMs < 1 || analysisTimeoutMs > 120_000) {
      throw new Error('SANDBOX_ANALYSIS_TIMEOUT_MS must be an integer between 1 and 120000 milliseconds.');
    }
  }

  private readonly baseUrl: string;
  private static readonly MAX_CAPTURE_BYTES = 5 * 1024 * 1024;

  public async analyze(attemptId: string, url: string): Promise<SandboxAnalysisOutput> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/analyze`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.serviceToken}`
        },
        body: JSON.stringify({ attemptId, url }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.analysisTimeoutMs)
      });
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new SandboxServiceError('sandbox_timeout', true);
      }
      throw new SandboxServiceError('sandbox_transport_error', true);
    }

    if (!response.ok) {
      throw new SandboxServiceError(
        response.status === 429 ? 'sandbox_rate_limited' : `sandbox_http_${response.status}`,
        response.status === 408 || response.status === 429 || response.status >= 500
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new SandboxServiceError('sandbox_invalid_response', true);
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new SandboxServiceError('sandbox_invalid_response', true);
    }

    const raw = data as Record<string, unknown>;
    if (raw['attemptId'] !== attemptId || typeof raw['targetUrl'] !== 'string' || typeof raw['finalDestination'] !== 'string' ||
      !Array.isArray(raw['redirects']) || !raw['redirects'].every((item) => typeof item === 'string') ||
      !Array.isArray(raw['signals']) || !raw['signals'].every((item) => typeof item === 'string') ||
      !Array.isArray(raw['sourceResults']) || !raw['sourceResults'].every((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const source = item as Record<string, unknown>;
        return typeof source['sourceName'] === 'string' && typeof source['status'] === 'string' &&
          typeof source['checkedAt'] === 'string' && !Number.isNaN(Date.parse(source['checkedAt'])) &&
          typeof source['expiresAt'] === 'string' && !Number.isNaN(Date.parse(source['expiresAt'])) &&
          (source['summary'] === undefined || typeof source['summary'] === 'string');
      })) {
      throw new SandboxServiceError('sandbox_invalid_response', true);
    }

    const common = {
      attemptId,
      targetUrl: raw['targetUrl'],
      finalDestination: raw['finalDestination'],
      redirects: raw['redirects'] as string[],
      signals: raw['signals'] as string[],
      sourceResults: (raw['sourceResults'] as Array<Record<string, unknown>>).map((s): SourceResult => ({
        sourceName: s['sourceName'] as string,
        status: s['status'] as string,
        checkedAt: new Date(s['checkedAt'] as string),
        expiresAt: new Date(s['expiresAt'] as string),
        ...(typeof s['summary'] === 'string' ? { summary: s['summary'] } : {})
      }))
    };

    if (raw['outcome'] === 'inconclusive') {
      const reasonCode = raw['reasonCode'];
      if ((reasonCode !== 'tls_certificate_invalid' && reasonCode !== 'resource_limit_exceeded') || raw['verdict'] !== undefined ||
        raw['reasons'] !== undefined || raw['screenshotRef'] !== undefined) {
        throw new SandboxServiceError('sandbox_invalid_response', true);
      }
      return { ...common, outcome: 'inconclusive', reasonCode };
    }

    const validVerdicts = ['peligroso', 'sospechoso', 'sin_amenazas_detectadas'];
    if (raw['outcome'] !== 'completed' || !validVerdicts.includes(String(raw['verdict'])) || !Array.isArray(raw['reasons']) ||
      !raw['reasons'].every((item) => typeof item === 'string') ||
      (raw['screenshotRef'] !== undefined && typeof raw['screenshotRef'] !== 'string')) {
      throw new SandboxServiceError('sandbox_invalid_response', true);
    }

    return {
      ...common,
      outcome: 'completed',
      verdict: raw['verdict'] as Verdict,
      reasons: raw['reasons'] as string[],
      ...(typeof raw['screenshotRef'] === 'string' ? { screenshotRef: raw['screenshotRef'] } : {})
    };
  }

  /** Fetches one opaque capture from the private Sandbox; never follows redirects. */
  public async getCapture(attemptId: string): Promise<Uint8Array | null> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/captures/${encodeURIComponent(attemptId)}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.serviceToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(this.analysisTimeoutMs)
      });
    } catch {
      throw new SandboxServiceError('sandbox_capture_transport_error', true);
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new SandboxServiceError(`sandbox_capture_http_${response.status}`, response.status >= 500);

    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    const declaredLength = Number(response.headers.get('content-length'));
    if (contentType !== 'image/webp' || (Number.isFinite(declaredLength) && declaredLength > HttpSandboxService.MAX_CAPTURE_BYTES)) {
      void response.body?.cancel().catch(() => undefined);
      throw new SandboxServiceError('sandbox_capture_invalid_response', false);
    }
    let bytes: Uint8Array;
    try {
      if (!response.body) throw new Error('missing body');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > HttpSandboxService.MAX_CAPTURE_BYTES) throw new Error('oversized');
          chunks.push(value);
        }
      } catch (error) {
        void reader.cancel().catch(() => undefined);
        throw error;
      }
      bytes = Buffer.concat(chunks, total);
    } catch {
      throw new SandboxServiceError('sandbox_capture_invalid_response', false);
    }
    if (bytes.byteLength < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') {
      throw new SandboxServiceError('sandbox_capture_invalid_response', false);
    }
    return bytes;
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        redirect: 'error',
        signal: AbortSignal.timeout(2000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
