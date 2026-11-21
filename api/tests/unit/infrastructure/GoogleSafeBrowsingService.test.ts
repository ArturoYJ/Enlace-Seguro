import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSafeBrowsingService } from '../../../src/infrastructure/reputation/GoogleSafeBrowsingService.js';

type Call = { url: string; body: Record<string, unknown> };

function fakeFetch(status: number, payload: unknown, calls: Call[] = []) {
  return async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
}

const fixedNow = () => new Date('2026-11-21T12:00:00.000Z');

describe('GoogleSafeBrowsingService', () => {
  it('rechaza una clave vacía', () => {
    assert.throws(() => new GoogleSafeBrowsingService({ apiKey: '' }));
  });

  it('envía las URLs sin duplicados a threatMatches:find con la clave', async () => {
    const calls: Call[] = [];
    const service = new GoogleSafeBrowsingService({ apiKey: 'test-key', fetchImpl: fakeFetch(200, {}, calls), now: fixedNow });
    await service.check(['https://a.example/', 'https://a.example/', 'https://b.example/']);
    assert.equal(calls.length, 1);
    assert.ok(calls[0]?.url.startsWith('https://safebrowsing.googleapis.com/v4/threatMatches:find?key=test-key'));
    const threatInfo = calls[0]?.body['threatInfo'] as { threatEntries: Array<{ url: string }> };
    assert.deepEqual(threatInfo.threatEntries, [{ url: 'https://a.example/' }, { url: 'https://b.example/' }]);
  });

  it('una respuesta vacía significa que no está listado', async () => {
    const service = new GoogleSafeBrowsingService({ apiKey: 'k', fetchImpl: fakeFetch(200, {}), now: fixedNow });
    const result = await service.check(['https://clean.example/']);
    assert.equal(result.status, 'clean');
  });

  it('interpreta las coincidencias y su tiempo de caché', async () => {
    const service = new GoogleSafeBrowsingService({
      apiKey: 'k',
      now: fixedNow,
      fetchImpl: fakeFetch(200, {
        matches: [
          { threatType: 'SOCIAL_ENGINEERING', platformType: 'ANY_PLATFORM', threat: { url: 'https://phish.example/' }, cacheDuration: '300s' },
          { threatType: 'MALWARE', platformType: 'ANY_PLATFORM', threat: { url: 'https://phish.example/' }, cacheDuration: '120s' }
        ]
      })
    });
    const result = await service.check(['https://phish.example/']);
    assert.equal(result.status, 'listed');
    if (result.status !== 'listed') return;
    assert.deepEqual(result.threatTypes, ['SOCIAL_ENGINEERING', 'MALWARE']);
    assert.equal(result.sourceResult.resultCode, 'SOCIAL_ENGINEERING,MALWARE');
    assert.equal(result.sourceResult.summary, 'Listado por Google Safe Browsing como phishing o engaño, software malicioso.');
    assert.equal(result.sourceResult.expiresAt.getTime() - fixedNow().getTime(), 120_000);
  });

  it('un error HTTP se reporta como no disponible sin exponer la clave', async () => {
    const service = new GoogleSafeBrowsingService({ apiKey: 'secret-key', fetchImpl: fakeFetch(403, { error: 'API key not valid secret-key' }) });
    const result = await service.check(['https://x.example/']);
    assert.deepEqual(result, { status: 'unavailable', failure: { sourceName: 'google_safe_browsing', reasonCode: 'http_403' } });
  });

  it('un tiempo de espera agotado no lanza error', async () => {
    const service = new GoogleSafeBrowsingService({
      apiKey: 'k',
      fetchImpl: async () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; }
    });
    const result = await service.check(['https://x.example/']);
    assert.equal(result.status, 'unavailable');
    if (result.status === 'unavailable') assert.equal(result.failure.reasonCode, 'timeout');
  });

  it('una respuesta con formato inesperado no se toma como limpia', async () => {
    const service = new GoogleSafeBrowsingService({ apiKey: 'k', fetchImpl: fakeFetch(200, { matches: 'nope' }) });
    assert.equal((await service.check(['https://x.example/'])).status, 'unavailable');
  });
});
