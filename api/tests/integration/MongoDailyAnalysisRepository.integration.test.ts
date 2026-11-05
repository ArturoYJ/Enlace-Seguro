import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoDailyAnalysisRepository } from '../../src/infrastructure/database/mongo/MongoDailyAnalysisRepository.js';
import { AesGcmAnalysisInputCipher } from '../../src/infrastructure/security/AesGcmAnalysisInputCipher.js';
import { getLocalDate } from '../../src/core/utils/dateUtils.js';

const mongoUri = process.env['MONGO_TEST_URI'];
const suite = mongoUri ? describe : describe.skip;
let client: MongoClient | undefined;

after(async () => {
  await client?.close();
});

suite('MongoDailyAnalysisRepository integration', () => {
  const resetQueueData = async (db: import('mongodb').Db) => {
    await db.collection('daily_analyses').deleteMany({});
    await db.collection('analysis_queue_capacity').updateOne({ _id: 'global' }, { $set: { pendingCount: 0, maxPending: 1000, updatedAt: new Date() } });
  };

  const readPersistedJob = async (db: import('mongodb').Db, userId: string, localDate: string, attemptId: string) => {
    const document = await db.collection('daily_analyses').findOne({
      userId: new ObjectId(userId), localDate, 'attempts.attemptId': attemptId
    });
    const attempts = document?.['attempts'] as Array<Record<string, unknown>> | undefined;
    const attempt = attempts?.find((candidate) => candidate['attemptId'] === attemptId);
    assert.ok(attempt, 'persisted attempt exists');
    const job = attempt['job'] as Record<string, unknown> | undefined;
    assert.ok(job, 'persisted job exists');
    return job;
  };

  const assertLeaseFieldsAbsent = (job: Record<string, unknown>) => {
    assert.equal(Object.hasOwn(job, 'leaseOwner'), false, 'released job removes its lease owner');
    assert.equal(Object.hasOwn(job, 'leaseToken'), false, 'released job removes its fencing token');
    assert.equal(Object.hasOwn(job, 'leaseExpiresAt'), false, 'released job removes its lease expiry');
  };
  it('anchors the shared daily-document TTL to its latest admitted attempt', async () => {
    assert.ok(mongoUri, 'MONGO_TEST_URI must point to an isolated disposable MongoDB test database');
    const parsed = new URL(mongoUri);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    assert.match(databaseName, /^enlaceseguro_test_[a-z0-9_-]+$/, 'refusing non-test database name');
    if (!client) { client = new MongoClient(mongoUri); await client.connect(); }
    const db = client.db(databaseName);
    await resetQueueData(db);
    const repository = new MongoDailyAnalysisRepository(db, new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x29)), client!);
    const userId = new ObjectId().toHexString();
    const localDate = '2026-11-04';
    const firstAt = new Date('2026-11-04T08:00:00.000Z');
    const laterAt = new Date(firstAt.getTime() + 12 * 60 * 60 * 1000);
    const attempt = (receivedAt: Date) => ({
      attemptId: randomUUID(),
      receivedAt,
      updatedAt: receivedAt,
      processingStatus: 'received' as const,
      inputDigest: 'c'.repeat(64),
      inputSizeBytes: 1
    });

    assert.equal((await repository.admitAttemptAtomic(userId, localDate, attempt(firstAt))).success, true);
    assert.equal((await repository.admitAttemptAtomic(userId, localDate, attempt(laterAt))).success, true);
    const daily = await db.collection('daily_analyses').findOne({ userId: new ObjectId(userId), localDate });
    assert.equal(
      (daily?.['historyPurgeAt'] as Date).getTime(),
      laterAt.getTime() + 366 * 24 * 60 * 60 * 1000,
      'shared TTL anchor must preserve every attempt for at least 366 days'
    );
  });

  it('admits exactly five attempts without losing writes or leaking duplicate-key errors', async () => {
    assert.ok(mongoUri, 'MONGO_TEST_URI must point to an isolated disposable MongoDB test database');
    const parsed = new URL(mongoUri);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    assert.match(databaseName, /^enlaceseguro_test_[a-z0-9_-]+$/, 'refusing non-test database name');

    if (!client) { client = new MongoClient(mongoUri); await client.connect(); }
    const db = client.db(databaseName);
    await resetQueueData(db);
    const buildInfo = await db.admin().command({ buildInfo: 1 });
    assert.match(String(buildInfo['version']), /^8\.0\./, 'expected MongoDB 8.0.x');

    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name).sort();
    assert.deepEqual(names, [
      'analysis_queue_capacity',
      'daily_analyses',
      'login_rate_limit_buckets',
      'reputation_cache',
      'refresh_tokens',
      'security_audit_events',
      'users'
    ].sort());
    assert.equal(await db.collection('daily_analyses').countDocuments({}), 0, 'test DB must be fresh');

    const repository = new MongoDailyAnalysisRepository(db, new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x29)), client!);
    await repository.assertInputEncryptionReady();
    const userId = new ObjectId().toHexString();
    const localDate = '2026-11-03';
    const inputPrefix = 'https://example.test/';
    const maxInput = inputPrefix + 'a'.repeat(65_536 - Buffer.byteLength(inputPrefix, 'utf8'));
    const attempts = Array.from({ length: 8 }, () => ({
      attemptId: randomUUID(),
      receivedAt: new Date(),
      updatedAt: new Date(),
      processingStatus: 'received' as const,
      inputDigest: 'a'.repeat(64),
      inputSizeBytes: Buffer.byteLength(maxInput, 'utf8'),
      submittedInput: maxInput
    }));

    const results: Array<PromiseSettledResult<Awaited<ReturnType<typeof repository.admitAttemptAtomic>>>> = [];
    for (const attempt of attempts) {
      try { results.push({ status: 'fulfilled', value: await repository.admitAttemptAtomic(userId, localDate, attempt, 5) }); }
      catch (reason) { results.push({ status: 'rejected', reason }); }
    }
    const rejected = results.filter((result) => result.status === 'rejected');
    const rejectedMessages = rejected.map((result) => result.status === 'rejected' ? result.reason.message : '');
    assert.deepEqual(rejectedMessages, [], 'concurrent admissions should resolve to success or quota, not database exceptions');

    const resolved = results.map((result) => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof repository.admitAttemptAtomic>>>).value);
    assert.equal(resolved.filter((result) => result.success).length, 5);
    assert.equal(resolved.filter((result) => !result.success && result.reason === 'quota_exceeded').length, 3);

    const daily = await repository.findDailyAnalysis(userId, localDate);
    assert.equal(daily?.attemptsCount, 5);
    assert.equal(await db.collection('daily_analyses').countDocuments({ userId: new ObjectId(userId), localDate }), 1);

    const admittedAttempt = resolved.find((result) => result.success)?.attempt;
    assert.ok(admittedAttempt);
    assert.equal(admittedAttempt.submittedInput, maxInput);
    const persistedDaily = await db.collection('daily_analyses').findOne({ userId: new ObjectId(userId), localDate });
    const encryptedAttempt = persistedDaily?.['attempts'] instanceof Array
      ? (persistedDaily['attempts'] as Array<Record<string, unknown>>).find((attempt) => attempt['attemptId'] === admittedAttempt.attemptId)
      : undefined;
    assert.ok(encryptedAttempt);
    assert.equal(encryptedAttempt['submittedInput'], undefined, 'new writes must not persist the plaintext input field');
    assert.notEqual(JSON.stringify(encryptedAttempt['submittedInputEncrypted']).includes(maxInput), true);
    const hydratedAttempt = await repository.findAttemptGlobally(admittedAttempt.attemptId);
    assert.equal(hydratedAttempt?.attempt.submittedInput, maxInput, 'repository hydration must decrypt 64 KiB for server-side processing/history');
    const duplicateInSameDay = await repository.admitAttemptAtomic(userId, localDate, admittedAttempt, 5);
    assert.deepEqual(duplicateInSameDay, { success: false, reason: 'duplicate_attempt_id' });

    const sixthAttempt = await repository.admitAttemptAtomic(userId, localDate, {
      attemptId: randomUUID(),
      receivedAt: new Date(),
      updatedAt: new Date(),
      processingStatus: 'received',
      inputDigest: 'b'.repeat(64),
      inputSizeBytes: 11
    }, 5);
    assert.deepEqual(sixthAttempt, { success: false, reason: 'quota_exceeded' });

    const duplicateAcrossDays = await repository.admitAttemptAtomic(new ObjectId().toHexString(), '2026-11-04', admittedAttempt, 5);
    assert.deepEqual(duplicateAcrossDays, { success: false, reason: 'duplicate_attempt_id' });

    assert.equal(await repository.updateAttempt(userId, localDate, admittedAttempt.attemptId, {
      processingStatus: 'processing'
    }), true);
    const updatedAttempt = await repository.findAttemptByLocalKey(userId, localDate, admittedAttempt.attemptId);
    assert.equal(updatedAttempt?.attempt.processingStatus, 'processing');

    const completedAt = new Date();
    const completedPayload = {
      verdict: 'sospechoso' as const,
      reasons: ['Resultado sintético de integración'],
      finalDestination: 'https://example.test/',
      sourceResults: [],
      sourceFailures: [],
      signals: [],
      redirects: []
    };
    const admittedClaim = await repository.claimNextAnalysisJob('history-worker', new Date(), 30_000);
    assert.equal(admittedClaim?.attemptId, admittedAttempt.attemptId);
    assert.equal(await repository.completeClaimedAnalysisJob(admittedClaim!, completedAt, completedPayload), true);
    assert.equal(await repository.updateAttempt(userId, localDate, admittedAttempt.attemptId, {
      processingStatus: 'failed', completedAt: new Date()
    }), false, 'a delayed failure must not overwrite a terminal completion');
    const terminalAttempt = await repository.findAttemptByLocalKey(userId, localDate, admittedAttempt.attemptId);
    assert.equal(terminalAttempt?.attempt.processingStatus, 'completed');
    assert.deepEqual(terminalAttempt?.attempt.analysis, completedPayload);

    const anotherReceived = resolved.find((result) => result.success && result.attempt?.attemptId !== admittedAttempt.attemptId)?.attempt;
    assert.ok(anotherReceived);
    assert.equal(await repository.updateAttempt(userId, localDate, anotherReceived.attemptId, {
      processingStatus: 'completed', completedAt: new Date(), analysis: completedPayload
    }), false, 'a job cannot skip the processing state');

    const expectedAttemptIds = new Set(attempts.filter((_attempt, index) => resolved[index]?.success).map((attempt) => attempt.attemptId));
    for (const olderDate of ['2026-11-02', '2026-11-01']) {
      const receivedAt = new Date(`${olderDate}T12:00:00.000Z`);
      for (let index = 0; index < 3; index += 1) {
        const attemptId = randomUUID();
        const admission = await repository.admitAttemptAtomic(userId, olderDate, {
          attemptId,
          receivedAt,
          updatedAt: receivedAt,
          processingStatus: 'received',
          inputDigest: String(index + 1).repeat(64),
          inputSizeBytes: 10
        }, 5);
        assert.equal(admission.success, true);
        expectedAttemptIds.add(attemptId);
      }
    }

    const pagedAttemptIds: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await repository.listUserAttempts(userId, { limit: 2, cursor: cursor ?? undefined });
      pagedAttemptIds.push(...page.items.map((item) => item.attemptId));
      cursor = page.nextCursor;
      pages += 1;
      assert.ok(pages <= 10, 'history pagination must terminate');
    } while (cursor);

    assert.equal(pagedAttemptIds.length, expectedAttemptIds.size);
    assert.equal(new Set(pagedAttemptIds).size, expectedAttemptIds.size, 'cursor pages must not repeat attempts');
    assert.deepEqual(new Set(pagedAttemptIds), expectedAttemptIds, 'cursor pages must not skip attempts');
    assert.ok(pages >= 5, 'small page size should exercise multiple cursor boundaries');

  });

  it('counts owner-scoped summary attempts only inside the exact half-open rolling window', async () => {
    assert.ok(mongoUri, 'MONGO_TEST_URI must point to an isolated disposable MongoDB test database');
    const parsed = new URL(mongoUri);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    assert.match(databaseName, /^enlaceseguro_test_[a-z0-9_-]+$/, 'refusing non-test database name');
    if (!client) { client = new MongoClient(mongoUri); await client.connect(); }
    const db = client.db(databaseName);
    await resetQueueData(db);
    const repository = new MongoDailyAnalysisRepository(db, new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x29)), client!);
    const userId = new ObjectId().toHexString();
    const otherUserId = new ObjectId().toHexString();
    const endsAtExclusive = new Date(Date.now() - 60_000);
    const startsAtInclusive = new Date(endsAtExclusive.getTime() - 365 * 24 * 60 * 60 * 1000);

    const addAttempt = async (ownerId: string, receivedAt: Date, verdict?: 'peligroso' | 'sospechoso') => {
      const attemptId = randomUUID();
      const localDate = getLocalDate(receivedAt);
      const admitted = await repository.admitAttemptAtomic(ownerId, localDate, {
        attemptId,
        receivedAt,
        updatedAt: receivedAt,
        processingStatus: 'received',
        inputDigest: 'c'.repeat(64),
        inputSizeBytes: 25,
        submittedInput: 'https://example.test/summary'
      });
      assert.equal(admitted.success, true);
      if (verdict) {
        const claim = await repository.claimNextAnalysisJob(`summary-${attemptId}`, new Date(endsAtExclusive.getTime() + 1), 30_000);
        assert.equal(claim?.attemptId, attemptId);
        assert.equal(await repository.completeClaimedAnalysisJob(claim!, endsAtExclusive, {
          verdict,
          reasons: ['Synthetic integration verdict'],
          finalDestination: 'https://example.test/summary',
          sourceResults: [],
          sourceFailures: [],
          signals: [],
          redirects: []
        }), true);
      } else {
        const claim = await repository.claimNextAnalysisJob(`summary-${attemptId}`, new Date(endsAtExclusive.getTime() + 1), 30_000);
        assert.equal(claim?.attemptId, attemptId);
        assert.equal(await repository.failClaimedAnalysisJob(claim!, endsAtExclusive, 'failed', 'synthetic_failure'), true);
      }
    };

    await addAttempt(userId, new Date(startsAtInclusive.getTime() - 1), 'peligroso');
    await addAttempt(userId, startsAtInclusive, 'peligroso');
    await addAttempt(userId, new Date(endsAtExclusive.getTime() - 1), 'sospechoso');
    await addAttempt(userId, endsAtExclusive, 'peligroso');
    await addAttempt(otherUserId, new Date(endsAtExclusive.getTime() - 1), 'peligroso');

    assert.deepEqual(await repository.getUserAnalysisSummary(userId, startsAtInclusive, endsAtExclusive), {
      total: 2,
      dangerous: 1,
      suspicious: 1
    });
    assert.deepEqual(await repository.getUserAnalysisSummary(otherUserId, startsAtInclusive, endsAtExclusive), {
      total: 1,
      dangerous: 1,
      suspicious: 0
    });
  });

  it('enforces the exact global pending cap across independent Mongo clients and releases slots only at terminalization', async () => {
    assert.ok(mongoUri);
    if (!client) { client = new MongoClient(mongoUri); await client.connect(); }
    const dbName = decodeURIComponent(new URL(mongoUri).pathname.slice(1));
    const db = client.db(dbName);
    await resetQueueData(db);
    await db.collection('analysis_queue_capacity').updateOne({ _id: 'global' }, { $set: { maxPending: 2 } });
    const secondClient = new MongoClient(mongoUri);
    await secondClient.connect();
    try {
      const left = new MongoDailyAnalysisRepository(client.db(dbName), new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x29)), client, 2);
      const right = new MongoDailyAnalysisRepository(secondClient.db(dbName), new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x29)), secondClient, 2);
      const repositories = Array.from({ length: 3 }, (_value, index) => index % 2 === 0 ? left : right);
      const results = await Promise.all(repositories.map((repository) => {
        const now = new Date();
        return repository.admitAttemptAtomic(new ObjectId().toHexString(), '2026-11-03', {
          attemptId: randomUUID(), receivedAt: now, updatedAt: now, processingStatus: 'received',
          inputDigest: 'b'.repeat(64), inputSizeBytes: 29, submittedInput: 'https://capacity.example.test/'
        });
      }));
      assert.equal(results.filter((result) => result.success).length, 2);
      assert.equal(results.filter((result) => !result.success && result.reason === 'capacity_exceeded').length, 1);
      assert.equal((await client.db(dbName).collection('analysis_queue_capacity').findOne({ _id: 'global' }))?.pendingCount, 2);
      const payload = { verdict: 'sospechoso' as const, reasons: [], finalDestination: 'https://capacity.example.test/', sourceResults: [], sourceFailures: [], signals: [], redirects: [] };
      for (const repository of [left, right]) {
        const claim = await repository.claimNextAnalysisJob('capacity-worker', new Date(), 30_000);
        assert.ok(claim);
        assert.equal(await repository.completeClaimedAnalysisJob(claim, new Date(), payload), true);
      }
      assert.equal((await client.db(dbName).collection('analysis_queue_capacity').findOne({ _id: 'global' }))?.pendingCount, 0);
    } finally { await secondClient.close(); }
  });

  it('atomically claims one durable job, reclaims expired leases, and fences stale workers', async () => {
    assert.ok(mongoUri, 'MONGO_TEST_URI must point to an isolated disposable MongoDB test database');
    if (!client) {
      client = new MongoClient(mongoUri);
      await client.connect();
    }
    const parsed = new URL(mongoUri);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    assert.match(databaseName, /^enlaceseguro_test_[a-z0-9_-]+$/);
    const db = client.db(databaseName);
    await resetQueueData(db);
    const userId = new ObjectId().toHexString();
    const repository = new MongoDailyAnalysisRepository(db, new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x29)), client!);
    const receivedAt = new Date();
    const admitted = await repository.admitAttemptAtomic(userId, '2026-11-03', {
      attemptId: randomUUID(), receivedAt, updatedAt: receivedAt, processingStatus: 'received',
      inputDigest: 'c'.repeat(64), inputSizeBytes: 25, submittedInput: 'https://queue.example.test/'
    });
    assert.equal(admitted.success, true);
    assert.ok(admitted.attempt);

    const firstClaim = await repository.claimNextAnalysisJob('worker-one', new Date(), 10_000);
    assert.ok(firstClaim);
    assert.equal(firstClaim.targetUrl, 'https://queue.example.test/');
    assert.equal(firstClaim.attemptNumber, 1);
    assert.equal(await repository.claimNextAnalysisJob('worker-two', new Date(), 10_000), null, 'an active lease cannot be claimed twice');

    const recovered = await repository.claimNextAnalysisJob('worker-two', new Date(Date.now() + 11_000), 10_000);
    assert.ok(recovered);
    assert.equal(recovered.attemptId, firstClaim.attemptId);
    assert.equal(recovered.attemptNumber, 2);
    assert.notEqual(recovered.leaseToken, firstClaim.leaseToken);

    const payload = {
      verdict: 'sospechoso' as const, reasons: [], finalDestination: 'https://queue.example.test/',
      sourceResults: [], sourceFailures: [], signals: [], redirects: []
    };
    assert.equal(await repository.completeClaimedAnalysisJob(firstClaim, new Date(), payload), false, 'expired worker token is fenced');
    assert.equal(await repository.completeClaimedAnalysisJob(recovered, new Date(), payload), true);
    const terminalJob = await readPersistedJob(db, userId, '2026-11-03', recovered.attemptId);
    assert.equal(terminalJob['state'], 'completed');
    assertLeaseFieldsAbsent(terminalJob);
    assert.equal(await repository.claimNextAnalysisJob('worker-three', new Date(Date.now() + 30_000), 10_000), null, 'terminal jobs are not redelivered');
  });

  it('reports durable queue health without exposing job or user identifiers', async () => {
    assert.ok(mongoUri, 'MONGO_TEST_URI must point to an isolated disposable MongoDB test database');
    if (!client) { client = new MongoClient(mongoUri); await client.connect(); }
    const databaseName = decodeURIComponent(new URL(mongoUri).pathname.slice(1));
    assert.match(databaseName, /^enlaceseguro_test_[a-z0-9_-]+$/);
    const db = client.db(databaseName);
    await resetQueueData(db);
    const repository = new MongoDailyAnalysisRepository(db, new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x29)), client!, 1000);
    const userId = new ObjectId().toHexString();
    const admittedAt = new Date(Date.now() - 5_000);
    const admission = await repository.admitAttemptAtomic(userId, '2026-11-04', {
      attemptId: randomUUID(), receivedAt: admittedAt, updatedAt: admittedAt, processingStatus: 'received',
      inputDigest: '9'.repeat(64), inputSizeBytes: 25, submittedInput: 'https://queue-metrics.example.test/'
    });
    assert.ok(admission.attempt);

    const queued = await repository.getAnalysisQueueSnapshot(new Date());
    assert.equal(queued.pendingCount, 1);
    assert.equal(queued.maxPending, 1000);
    assert.equal(queued.queuedCount, 1);
    assert.equal(queued.leasedCount, 0);
    assert.equal(queued.oldestPendingAgeMs !== null && queued.oldestPendingAgeMs >= 5_000, true);

    const leaseStartedAt = new Date();
    const firstClaim = await repository.claimNextAnalysisJob('metrics-worker', leaseStartedAt, 10_000, 2);
    assert.ok(firstClaim);
    const expiredAt = new Date(leaseStartedAt.getTime() + 10_001);
    const expiredLease = await repository.getAnalysisQueueSnapshot(expiredAt);
    assert.equal(expiredLease.pendingCount, 1);
    assert.equal(expiredLease.leasedCount, 1);
    assert.equal(expiredLease.expiredLeaseCount, 1);

    const retryClaim = await repository.claimNextAnalysisJob('metrics-worker-recovery', expiredAt, 10_000, 2);
    assert.ok(retryClaim);
    const retrying = await repository.getAnalysisQueueSnapshot(expiredAt);
    assert.equal(retrying.retryingCount, 1);
    assert.equal(retrying.expiredLeaseCount, 0);
    assert.equal(JSON.stringify(retrying).includes(userId), false);
    assert.equal(JSON.stringify(retrying).includes(admission.attempt.attemptId), false);
  });

  it('clears lease metadata when a retry returns a job to the queue', async () => {
    assert.ok(mongoUri, 'MONGO_TEST_URI must point to an isolated disposable MongoDB test database');
    if (!client) {
      client = new MongoClient(mongoUri);
      await client.connect();
    }
    const parsed = new URL(mongoUri);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    assert.match(databaseName, /^enlaceseguro_test_[a-z0-9_-]+$/);
    const db = client.db(databaseName);
    await resetQueueData(db);
    const userId = new ObjectId().toHexString();
    const admittedAt = new Date();
    const admission = await new MongoDailyAnalysisRepository(db, new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x29)), client!).admitAttemptAtomic(
      userId, '2026-11-03', {
        attemptId: randomUUID(), receivedAt: admittedAt, updatedAt: admittedAt, processingStatus: 'received',
        inputDigest: 'd'.repeat(64), inputSizeBytes: 25, submittedInput: 'https://retry.example.test/'
      }
    );
    assert.ok(admission.attempt);
    const repository = new MongoDailyAnalysisRepository(db, new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x29)), client!);
    const claim = await repository.claimNextAnalysisJob('retry-worker', new Date(), 10_000);
    assert.ok(claim);
    const retryAt = new Date(Date.now() + 5_000);
    assert.equal(await repository.retryClaimedAnalysisJob(claim, new Date(), retryAt, 'sandbox_unavailable', 4), 'rescheduled');
    const queuedJob = await readPersistedJob(db, userId, '2026-11-03', admission.attempt.attemptId);
    assert.equal(queuedJob['state'], 'queued');
    assertLeaseFieldsAbsent(queuedJob);
  });

  it('terminalizes repeated worker crashes at the attempt limit instead of leaving an immortal processing job', async () => {
    assert.ok(mongoUri, 'MONGO_TEST_URI must point to an isolated disposable MongoDB test database');
    if (!client) {
      client = new MongoClient(mongoUri);
      await client.connect();
    }
    const parsed = new URL(mongoUri);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    assert.match(databaseName, /^enlaceseguro_test_[a-z0-9_-]+$/);
    const db = client.db(databaseName);
    await resetQueueData(db);
    const userId = new ObjectId().toHexString();
    const repository = new MongoDailyAnalysisRepository(db, new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x29)), client!);
    const receivedAt = new Date();
    const admission = await repository.admitAttemptAtomic(userId, '2026-11-03', {
      attemptId: randomUUID(), receivedAt, updatedAt: receivedAt, processingStatus: 'received',
      inputDigest: 'e'.repeat(64), inputSizeBytes: 25, submittedInput: 'https://crash.example.test/'
    });
    assert.ok(admission.attempt);

    const first = await repository.claimNextAnalysisJob('crash-worker-a', new Date(), 10_000, 2);
    assert.ok(first);
    const second = await repository.claimNextAnalysisJob('crash-worker-b', new Date(Date.now() + 11_000), 10_000, 2);
    assert.ok(second);
    assert.equal(second.attemptNumber, 2);
    const exhausted = await repository.claimNextAnalysisJob('crash-worker-c', new Date(Date.now() + 22_000), 10_000, 2);
    assert.equal(exhausted?.leaseExhausted, true);
    assert.equal(exhausted?.attemptId, admission.attempt.attemptId);
    const final = await repository.findAttemptByLocalKey(userId, '2026-11-03', admission.attempt.attemptId);
    assert.equal(final?.attempt.processingStatus, 'failed');
    const terminalJob = await readPersistedJob(db, userId, '2026-11-03', admission.attempt.attemptId);
    assert.equal(terminalJob['state'], 'dead');
    assertLeaseFieldsAbsent(terminalJob);
    assert.equal(await repository.claimNextAnalysisJob('crash-worker-d', new Date(Date.now() + 40_000), 10_000, 2), null);
  });

  it('commits an inconclusive terminal status without persisting a security verdict', async () => {
    assert.ok(mongoUri, 'MONGO_TEST_URI must point to an isolated disposable MongoDB test database');
    if (!client) {
      client = new MongoClient(mongoUri);
      await client.connect();
    }
    const parsed = new URL(mongoUri);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    assert.match(databaseName, /^enlaceseguro_test_[a-z0-9_-]+$/);
    const db = client.db(databaseName);
    await resetQueueData(db);
    const userId = new ObjectId().toHexString();
    const repository = new MongoDailyAnalysisRepository(db, new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x29)), client!);
    const receivedAt = new Date();
    const admission = await repository.admitAttemptAtomic(userId, '2026-11-03', {
      attemptId: randomUUID(), receivedAt, updatedAt: receivedAt, processingStatus: 'received',
      inputDigest: 'f'.repeat(64), inputSizeBytes: 30, submittedInput: 'https://invalid-cert.example/'
    });
    assert.ok(admission.attempt);
    const claim = await repository.claimNextAnalysisJob('tls-worker', new Date(), 60_000);
    assert.ok(claim);
    assert.equal(await repository.failClaimedAnalysisJob(claim, new Date(), 'inconclusive', 'tls_certificate_invalid'), true);
    const result = await repository.findAttemptByLocalKey(userId, '2026-11-03', admission.attempt.attemptId);
    assert.equal(result?.attempt.processingStatus, 'inconclusive');
    assert.equal(result?.attempt.analysis, undefined);
    const terminalJob = await readPersistedJob(db, userId, '2026-11-03', admission.attempt.attemptId);
    assert.equal(terminalJob['state'], 'dead');
    assertLeaseFieldsAbsent(terminalJob);
    assert.equal(await repository.claimNextAnalysisJob('tls-worker-retry', new Date(Date.now() + 60_001), 60_000), null);
  });
});
