const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

const requireFromApi = createRequire(path.resolve(__dirname, '../../api/package.json'));
const { MongoClient, ObjectId } = requireFromApi('mongodb');

const mongoUri = process.env.MONGO_TEST_URI;

test('expired daily analysis is filtered by repository and eventually removed by MongoDB TTL', async () => {
  assert.ok(mongoUri, 'MONGO_TEST_URI must point to a disposable enlaceseguro_test_* database');
  const parsedUri = new URL(mongoUri);
  const databaseName = decodeURIComponent(parsedUri.pathname.slice(1));
  assert.match(databaseName, /^enlaceseguro_test_[a-z0-9_-]+$/, 'refusing non-test database name');

  const client = new MongoClient(mongoUri);
  let originalTtlMonitorEnabled;
  let insertedId;
  let database;

  try {
    await client.connect();
    const buildInfo = await client.db('admin').command({ buildInfo: 1 });
    assert.match(String(buildInfo.version), /^8\.0\./, 'expected MongoDB 8.0.x');

    database = client.db(databaseName);
    const collection = database.collection('daily_analyses');
    const admin = client.db('admin');
    const parameter = await admin.command({ getParameter: 1, ttlMonitorEnabled: 1 });
    originalTtlMonitorEnabled = Boolean(parameter.ttlMonitorEnabled);

    // The test collection is disposable. Pause TTL so the query path can be checked
    // deterministically after expiry but before MongoDB physically deletes the row.
    await admin.command({ setParameter: 1, ttlMonitorEnabled: false });

    const userId = new ObjectId();
    const attemptId = require('node:crypto').randomUUID();
    const purgeAt = new Date(Date.now() + 3000);
    const inserted = await collection.insertOne({
      _id: new ObjectId(),
      schemaVersion: 1,
      userId,
      localDate: new Date().toISOString().slice(0, 10),
      attempts: [{
        attemptId,
        receivedAt: new Date(),
        updatedAt: new Date(),
        processingStatus: 'failed',
        inputDigest: 'a'.repeat(64),
        inputSizeBytes: 10,
        job: { state: 'dead', attemptCount: 1, availableAt: new Date() }
      }],
      historyPurgeAt: purgeAt,
      purgeAt
    });
    insertedId = inserted.insertedId;
    assert.equal(await collection.countDocuments({ _id: insertedId }), 1, 'expired test record must exist before query-path check');

    const remainingUntilExpiry = Math.max(0, purgeAt.getTime() - Date.now());
    if (remainingUntilExpiry > 0) {
      await new Promise((resolve) => setTimeout(resolve, remainingUntilExpiry + 100));
    }

    assert.equal(await collection.countDocuments({ _id: insertedId }), 1, 'TTL is paused; record must still exist after purgeAt');
    const repositoryPath = path.resolve(
      __dirname,
      '../../api/dist/infrastructure/database/mongo/MongoDailyAnalysisRepository.js'
    );
    assert.ok(require('node:fs').existsSync(repositoryPath), 'build API first; MongoDailyAnalysisRepository dist module is required');
    const { MongoDailyAnalysisRepository } = await import(pathToFileURL(repositoryPath).href);
    const cipherPath = path.resolve(
      __dirname,
      '../../api/dist/infrastructure/security/AesGcmAnalysisInputCipher.js'
    );
    assert.ok(require('node:fs').existsSync(cipherPath), 'build API first; input cipher dist module is required');
    const { AesGcmAnalysisInputCipher } = await import(pathToFileURL(cipherPath).href);
    const repository = new MongoDailyAnalysisRepository(database, new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x29)), client);
    const history = await repository.listUserAttempts(userId.toHexString(), { limit: 5 });
    assert.deepEqual(history.items, [], 'repository list must exclude expired rows while TTL has not deleted them');
    assert.equal(await collection.countDocuments({ _id: insertedId }), 1, 'query-path assertion must precede physical TTL deletion');

    await admin.command({ setParameter: 1, ttlMonitorEnabled: true });
    const timeoutAt = Date.now() + 150_000; // Covers at least two default 60-second TTL monitor intervals.
    while (Date.now() < timeoutAt) {
      if (await collection.countDocuments({ _id: insertedId }) === 0) {
        console.log('PASS: expired history filtered before TTL; document later removed by TTL monitor');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    assert.fail('expired daily_analyses document was not removed within 150 seconds by the TTL monitor');
  } finally {
    if (database && insertedId) {
      await database.collection('daily_analyses').deleteOne({ _id: insertedId }).catch(() => undefined);
    }
    if (originalTtlMonitorEnabled !== undefined) {
      await client.db('admin').command({ setParameter: 1, ttlMonitorEnabled: originalTtlMonitorEnabled }).catch(() => undefined);
    }
    await client.close();
  }
});
