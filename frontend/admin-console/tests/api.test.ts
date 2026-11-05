import { describe, expect, it, vi } from 'vitest';
import { AdminApi, ApiError, apiBaseUrl } from '../src/lib/api';
import { defaultRange, validRange } from '../src/lib/dates';

const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1', tokenType: 'Bearer', expiresIn: 900 };
const profile = { user: { id: 'admin-1', email: 'admin@example.test', role: 'admin' } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('admin API session', () => {
  it('calls the browser fetch transport with its global receiver', async () => {
    const fetcher = vi.fn(function (this: unknown, input: RequestInfo | URL): Promise<Response> {
      expect(this).toBe(globalThis);
      return Promise.resolve(String(input).endsWith('/auth/login') ? json(tokens) : json(profile));
    });
    vi.stubGlobal('fetch', fetcher);
    try {
      const api = new AdminApi('https://api.test/api/v1', () => {});
      await api.login('admin@example.test', 'password');
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('authenticates admin in memory, sends bearer, and preserves opaque cursors', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      if (url.endsWith('/auth/login')) return json(tokens);
      if (url.endsWith('/auth/me')) return json(profile);
      return json({ items: [], hasMore: false, nextCursor: null });
    });
    const api = new AdminApi('https://api.test/api/v1', () => {}, fetcher as typeof fetch);
    expect((await api.login('admin@example.test', 'password')).user.role).toBe('admin');
    await api.audit({ startDate: '2026-11-01', endDate: '2026-11-03' }, 'analysis.failed', 'opaque+/=');
    const audit = calls.at(-1)!;
    expect(new Headers(audit.init?.headers).get('authorization')).toBe('Bearer access-1');
    expect(new URL(audit.url).searchParams.get('cursor')).toBe('opaque+/=');
    expect(new URL(audit.url).searchParams.get('eventType')).toBe('analysis.failed');
    expect(audit.init?.credentials).toBe('omit');
    api.clear();
    await expect(api.audit({ startDate: '2026-11-01', endDate: '2026-11-03' }, '')).rejects.toMatchObject({ status: 401 });
  });
  it('refuses non-admin accounts and clears their credentials', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/login') ? json(tokens) : json({ user: { role: 'usuario' } }));
    const api = new AdminApi('https://api.test', () => {}, fetcher as typeof fetch);
    await expect(api.login('user@example.test', 'password')).rejects.toMatchObject({ status: 403 });
    await expect(api.audit({ startDate: '2026-11-01', endDate: '2026-11-03' }, '')).rejects.toMatchObject({ status: 401 });
  });
  it('rotates on a 401 once and retries with the new bearer', async () => {
    let attempts = 0; let bearer = '';
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return json(tokens);
      if (url.endsWith('/auth/me')) return json(profile);
      if (url.endsWith('/auth/refresh')) return json({ ...tokens, accessToken: 'access-2', refreshToken: 'refresh-2' });
      attempts += 1; bearer = new Headers(init?.headers).get('authorization') ?? '';
      return attempts === 1 ? json({}, 401) : json({ items: [], hasMore: false, nextCursor: null });
    });
    const api = new AdminApi('https://api.test', () => {}, fetcher as typeof fetch);
    await api.login('admin@example.test', 'password');
    await api.audit({ startDate: '2026-11-01', endDate: '2026-11-03' }, '');
    expect(attempts).toBe(2); expect(bearer).toBe('Bearer access-2');
  });
  it('expires session when refresh fails, and never turns incomplete metrics into zeroes', async () => {
    let expired = 0; let failRefresh = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return json(tokens);
      if (url.endsWith('/auth/me')) return json(profile);
      if (url.endsWith('/auth/refresh')) return json({}, 401);
      return failRefresh ? json({}, 401) : json({ totalAttempts: 0, byStatus: {}, byVerdict: {} });
    });
    const api = new AdminApi('https://api.test', () => { expired++; }, fetcher as typeof fetch);
    await api.login('admin@example.test', 'password');
    await expect(api.metrics({ startDate: '2026-11-01', endDate: '2026-11-03' })).rejects.toBeInstanceOf(ApiError);
    failRefresh = true;
    await expect(api.audit({ startDate: '2026-11-01', endDate: '2026-11-03' }, '')).rejects.toMatchObject({ status: 401 });
    expect(expired).toBe(1);
  });
});

describe('configuration and civil dates', () => {
  it('allows loopback HTTP only in development and rejects credentialed or non-HTTPS origins', () => {
    expect(apiBaseUrl('http://localhost:3000/api/v1', false)).toBe('http://localhost:3000/api/v1');
    expect(() => apiBaseUrl('http://localhost:3000/api/v1', true)).toThrow();
    expect(() => apiBaseUrl('http://other.test', false)).toThrow();
    expect(() => apiBaseUrl('https://user:secret@api.test', true)).toThrow();
  });
  it('uses Mexico City civil date and rejects impossible or reversed ranges', () => {
    expect(defaultRange(new Date('2026-11-01T03:00:00Z'))).toEqual({ startDate: '2026-10-01', endDate: '2026-10-31' });
    expect(validRange({ startDate: '2026-02-30', endDate: '2026-03-01' })).toBe(false);
    expect(validRange({ startDate: '2026-11-03', endDate: '2026-11-01' })).toBe(false);
  });
});
