import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoReputationQuota } from '../../src/infrastructure/reputation/MongoReputationQuota.js';
import { VirusTotalReputationProvider } from '../../src/infrastructure/reputation/VirusTotalReputationProvider.js';
import { ProcessAnalysisJobUseCase } from '../../src/use-cases/analysis/ProcessAnalysisJobUseCase.js';
import { MockDailyAnalysisRepository, MockSecurityAuditRepository } from '../mocks/MockRepositories.js';

const uri = process.env['MONGO_TEST_URI'];
const suite = uri ? describe : describe.skip;

suite('VirusTotal shared quota integration', () => {
  it('bounds concurrent reservations across instances, persists them, and respects cooldown', async () => {
    assert.ok(uri);
    const dbName = decodeURIComponent(new URL(uri).pathname.slice(1));
    assert.match(dbName, /^enlaceseguro_test_[a-z0-9_-]+$/);
    const client = new MongoClient(uri);
    await client.connect();
    try {
      const db = client.db(dbName); const key = randomBytes(32).toString('hex');
      const first = new MongoReputationQuota(db, key); const second = new MongoReputationQuota(db, key);
      // Initialize before contention; real callers may conservatively fail initialization races.
      assert.equal(await first.reserve(), true);
      const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).reserve()));
      assert.equal(results.filter(Boolean).length, 3);
      assert.equal(await new MongoReputationQuota(db, key).reserve(), false);
      const cooldownKey = randomBytes(32).toString('hex');
      const cooldownFirst = new MongoReputationQuota(db, cooldownKey);
      const cooldownSecond = new MongoReputationQuota(db, cooldownKey);
      assert.equal(await cooldownFirst.reserve(), true);
      await cooldownFirst.cooldown();
      assert.equal(await cooldownSecond.reserve(), false, '429 cooldown must block a second worker with remaining minute quota');

      const dailyKey = randomBytes(32).toString('hex');
      const id = createHmac('sha256', dailyKey).update('enlaceseguro-virustotal-quota-v1').digest('hex');
      await db.collection('reputation_quota').insertOne({ _id: id as never,
        requests: Array.from({ length: 499 }, () => new Date(Date.now() - 2 * 60 * 1000)), cooldownUntil: new Date(0) });
      const dailyFirst = new MongoReputationQuota(db, dailyKey);
      const dailySecond = new MongoReputationQuota(db, dailyKey);
      const daily = await Promise.all([dailyFirst.reserve(), dailySecond.reserve()]);
      assert.equal(daily.filter(Boolean).length, 1, 'rolling daily limit must hold under concurrent reservations');

      const cacheKey = randomBytes(32).toString('hex');
      const url = 'https://example.test/path';
      let transportCalls = 0;
      const provider = new VirusTotalReputationProvider(cacheKey, new Set([url]), new MongoReputationQuota(db, cacheKey),
        async () => { transportCalls++; return new Response(JSON.stringify({ data: { attributes: {
          last_analysis_stats: { malicious: 0 }, last_analysis_date: Math.floor(Date.now() / 1000)
        } } })); });
      assert.equal((await provider.check(url)).status, 'no_match');
      assert.equal((await provider.check(url)).status, 'no_match');
      assert.equal(transportCalls, 1, 'cache must avoid the second request');
      const cacheId = createHmac('sha256', cacheKey).update('enlaceseguro-virustotal-quota-v1').digest('hex');
      const cachedQuota = await db.collection('reputation_quota').findOne({ _id: cacheId as never });
      assert.equal(cachedQuota?.['requests']?.length, 1);

      // Real MongoDB quota plus a simulated Sandbox, VirusTotal transport and analysis repository.
      const workerKey = randomBytes(32).toString('hex');
      const dailyRepository = new MockDailyAnalysisRepository();
      const auditRepository = new MockSecurityAuditRepository();
      const workerProvider = new VirusTotalReputationProvider(workerKey, new Set([url]), new MongoReputationQuota(db, workerKey),
        async () => new Response(JSON.stringify({ data: { attributes: {
          last_analysis_stats: { malicious: 1 }, last_analysis_date: Math.floor(Date.now() / 1000)
        } } })));
      const sandbox = { analyze: async (attemptId: string) => ({ outcome: 'completed' as const, attemptId,
        targetUrl: url, finalDestination: url, redirects: [], signals: [], verdict: 'sin_amenazas_detectadas' as const,
        reasons: [], sourceResults: [] }), isHealthy: async () => true };
      const receivedAt = new Date();
      await dailyRepository.admitAttemptAtomic('user-1', '2026-11-20', { attemptId: 'vt-integration',
        receivedAt, updatedAt: receivedAt, processingStatus: 'received', inputDigest: 'a'.repeat(64),
        inputSizeBytes: Buffer.byteLength(url), submittedInput: url });
      const job = await dailyRepository.claimNextAnalysisJob('worker', new Date(), 60_000);
      assert.ok(job);
      await new ProcessAnalysisJobUseCase(dailyRepository, auditRepository, sandbox, 4, workerProvider).execute(job);
      const attempt = (await dailyRepository.findAttemptByLocalKey('user-1', '2026-11-20', 'vt-integration'))?.attempt;
      assert.equal(attempt?.processingStatus, 'completed');
      assert.equal(attempt?.analysis?.verdict, 'sospechoso');
      assert.equal(attempt?.analysis?.sourceResults[0]?.sourceName, 'VirusTotal');
      const records = await db.collection('reputation_quota').find({}).toArray();
      assert.doesNotMatch(JSON.stringify(records), new RegExp(key));
    } finally { await client.close(); }
  });
});
