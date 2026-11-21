import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VirusTotalReputationProvider } from '../../../src/infrastructure/reputation/VirusTotalReputationProvider.js';
import type { IReputationQuota } from '../../../src/core/ports/IReputationProvider.js';

const url = 'https://example.test/path';
const now = new Date('2026-11-20T12:00:00Z');
const report = (malicious: number) => JSON.stringify({ data: { attributes: {
  last_analysis_stats: { malicious }, last_analysis_date: 1795176000
} } });

describe('VirusTotal reputation with simulated transport', () => {
  it('checks only the exact authorised URL with a GET and no redirects', async () => {
    let calls = 0;
    const quota: IReputationQuota = { reserve: async () => true, cooldown: async () => undefined };
    const transport: typeof fetch = async (input, init) => {
      calls++;
      assert.equal(String(input), `https://www.virustotal.com/api/v3/urls/${Buffer.from(url).toString('base64url')}`);
      assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).get('x-apikey'), 'test-key');
      return new Response(report(2), { status: 200 });
    };
    const provider = new VirusTotalReputationProvider('test-key', new Set([url]), quota, transport, () => now);
    for (const input of [url + '?token=x', url + '#fragment', 'https://user:password@example.test/path',
      'http://127.0.0.1/', 'https://other.test/']) {
      assert.equal((await provider.check(input)).status, 'not_queried');
    }
    const result = await provider.check(url);
    assert.equal(result.status, 'match'); assert.equal(calls, 1);
  });

  it('does not call the transport if quota is exhausted or unavailable', async () => {
    let calls = 0;
    const transport: typeof fetch = async () => { calls++; throw new Error('unexpected'); };
    for (const quota of [
      { reserve: async () => false, cooldown: async () => undefined },
      { reserve: async () => { throw new Error('unavailable'); }, cooldown: async () => undefined }
    ]) {
      const provider = new VirusTotalReputationProvider('test-key', new Set([url]), quota, transport, () => now);
      assert.ok(['rate_limited', 'error'].includes((await provider.check(url)).status));
    }
    assert.equal(calls, 0);
  });

  it('distinguishes clean reports, missing reports, rate limits and provider errors', async () => {
    let status = 200; let body = report(0); let cooldowns = 0;
    let instant = now;
    const quota = { reserve: async () => true, cooldown: async () => { cooldowns++; } };
    const transport: typeof fetch = async () => new Response(body, { status });
    const provider = new VirusTotalReputationProvider('test-key', new Set([url]), quota, transport, () => instant);
    assert.equal((await provider.check(url)).status, 'no_match');
    instant = new Date(now.getTime() + 5 * 60 * 1000);
    status = 404; assert.equal((await provider.check(url)).status, 'not_found');
    status = 429; assert.equal((await provider.check(url)).status, 'rate_limited'); assert.equal(cooldowns, 1);
    for (status of [401, 403, 500]) assert.equal((await provider.check(url)).status, 'error');
    status = 200; body = 'invalid-json'; assert.equal((await provider.check(url)).status, 'error');
  });

  it('caches only successful reports briefly without consuming additional quota', async () => {
    let instant = now; let calls = 0; let reservations = 0;
    const quota = { reserve: async () => { reservations++; return true; }, cooldown: async () => undefined };
    const provider = new VirusTotalReputationProvider('test-key', new Set([url]), quota,
      async () => { calls++; return new Response(report(1)); }, () => instant);
    assert.equal((await provider.check(url)).status, 'match');
    assert.equal((await provider.check(url)).status, 'match');
    assert.equal(calls, 1); assert.equal(reservations, 1);
    instant = new Date(now.getTime() + 5 * 60 * 1000);
    assert.equal((await provider.check(url)).status, 'match');
    assert.equal(calls, 2); assert.equal(reservations, 2);
    assert.doesNotMatch(JSON.stringify([...((provider as unknown as { cache: Map<string, unknown> }).cache.entries())]), /example\.test/);
  });

  it('returns an error on transport failure without exposing the error message', async () => {
    const quota = { reserve: async () => true, cooldown: async () => undefined };
    const transport: typeof fetch = async () => { throw new Error('secret URL and API key'); };
    const provider = new VirusTotalReputationProvider('test-key', new Set([url]), quota, transport, () => now);
    assert.deepEqual(await provider.check(url), { status: 'error', checkedAt: now });
  });

  it('rejects prohibited URLs even when mistakenly included in the allowlist', async () => {
    const forbidden = ['https://example.test/path?token=x', 'https://example.test/#secret',
      'https://user:password@example.test/', 'http://127.0.0.1/', 'https://service.local/'];
    let calls = 0;
    const quota = { reserve: async () => { calls++; return true; }, cooldown: async () => undefined };
    const provider = new VirusTotalReputationProvider('test-key', new Set(forbidden), quota,
      async () => { throw new Error('transport called'); }, () => now);
    for (const value of forbidden) assert.equal((await provider.check(value)).status, 'not_queried');
    assert.equal(calls, 0);
  });

  it('rejects missing, negative or future-dated reputation reports', async () => {
    let body = '{}';
    const quota = { reserve: async () => true, cooldown: async () => undefined };
    const provider = new VirusTotalReputationProvider('test-key', new Set([url]), quota,
      async () => new Response(body), () => now);
    for (body of ['{}', report(-1), JSON.stringify({data: {attributes: {last_analysis_stats: {malicious: 1}, last_analysis_date: 9999999999}}}),
      JSON.stringify({data: {attributes: {last_analysis_stats: {malicious: 0}, last_analysis_date: 1}}})]) {
      assert.equal((await provider.check(url)).status, 'error');
    }
  });
});
