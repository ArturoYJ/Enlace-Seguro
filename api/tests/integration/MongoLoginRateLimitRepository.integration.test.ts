import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { MongoLoginRateLimitRepository } from '../../src/infrastructure/database/mongo/MongoLoginRateLimitRepository.js';

const mongoUri = process.env['MONGO_TEST_URI'];
const suite = mongoUri ? describe : describe.skip;
let client: MongoClient | undefined;

after(async () => {
  await client?.close();
});

suite('MongoLoginRateLimitRepository integration', () => {
  it('enforces atomic shared buckets, expiration windows, cleanup and strict HMAC-only schema', async () => {
    assert.ok(mongoUri, 'MONGO_TEST_URI must point to an isolated disposable MongoDB test database');
    const parsed = new URL(mongoUri);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    assert.match(databaseName, /^enlaceseguro_test_[a-z0-9_-]+$/, 'refusing non-test database name');

    client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db(databaseName);
    const first = new MongoLoginRateLimitRepository(db);
    const second = new MongoLoginRateLimitRepository(db);
    await first.assertReady();

    const indexes = await db.collection('login_rate_limit_buckets').listIndexes().toArray();
    assert.ok(indexes.some((index) => index.name === 'ttl_login_rate_limit_expires_at' && index.expireAfterSeconds === 0));

    const bucketId = `v1:${'a'.repeat(64)}`;
    const now = new Date('2026-11-03T12:00:00.000Z');
    const cutoff = new Date(now.getTime() - 60_000);
    const expiresAt = new Date(now.getTime() + 60_000);
    const accepted = await Promise.all(Array.from({ length: 40 }, (_item, index) =>
      (index % 2 ? first : second).tryRecordEvent(bucketId, now, cutoff, expiresAt, 20)
    ));
    assert.equal(accepted.filter(Boolean).length, 20, 'independent API repository instances must share the atomic quota');
    assert.equal((await first.getRecentEvents(bucketId, cutoff)).length, 20);

    const later = new Date(now.getTime() + 60_001);
    assert.equal(await second.tryRecordEvent(
      bucketId,
      later,
      new Date(later.getTime() - 60_000),
      new Date(later.getTime() + 60_000),
      20
    ), true, 'expired events must not consume a later window');
    assert.equal((await first.getRecentEvents(bucketId, new Date(later.getTime() - 60_000))).length, 1);

    await first.deleteBucket(bucketId);
    assert.equal((await second.getRecentEvents(bucketId, cutoff)).length, 0, 'successful login must clear account failures');

    await assert.rejects(
      () => db.collection('login_rate_limit_buckets').insertOne({
        _id: `v1:${'b'.repeat(64)}`,
        schemaVersion: 1,
        events: [],
        expiresAt: new Date(Date.now() + 60_000),
        email: 'must-not-be-stored@example.com'
      }),
      /document failed validation|Document failed validation/i,
      'strict collection schema must reject raw identity fields'
    );
  });
});
