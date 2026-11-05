// Execute only in a throwaway database created from 001_create_mongodb_schema.js.
// This script writes records; the database-name guard is intentionally strict.
(function runMongoSmokeTests() {
  const databaseName = db.getName();
  const version = db.version();
  if (!/^enlaceseguro_test_[a-z0-9_-]+$/.test(databaseName)) {
    throw new Error(`Refusing writes to non-test database '${databaseName}'.`);
  }
  if (!version.startsWith("8.0.")) {
    throw new Error(`Expected MongoDB 8.0.x, got ${version}.`);
  }

  const expectedCollections = [
    "analysis_queue_capacity",
    "daily_analyses",
    "login_rate_limit_buckets",
    "reputation_cache",
    "refresh_tokens",
    "security_audit_events",
    "users"
  ].sort();
  const actualCollections = db.getCollectionNames().sort();
  if (JSON.stringify(actualCollections) !== JSON.stringify(expectedCollections)) {
    throw new Error(`Expected bootstrapped test collections; got ${JSON.stringify(actualCollections)}.`);
  }

  let passed = 0;
  function check(condition, message) {
    if (!condition) throw new Error(`FAIL: ${message}`);
    passed += 1;
    print(`PASS: ${message}`);
  }

  function expectError(code, action, message) {
    try {
      action();
    } catch (error) {
      if (error.code === code) {
        passed += 1;
        print(`PASS: ${message}`);
        return;
      }
      throw new Error(`${message}: expected Mongo error ${code}, got ${error.code}: ${error.message}`);
    }
    throw new Error(`${message}: operation unexpectedly succeeded`);
  }

  function newAttemptId() {
    return `00000000-0000-4000-8000-${new ObjectId().toHexString().slice(-12)}`;
  }

  function newUser(email, role = "usuario") {
    const now = new Date();
    return {
      _id: new ObjectId(),
      schemaVersion: 1,
      emailNormalized: email,
      passwordHash: "test-hash-only",
      role,
      accountStatus: "active",
      createdAt: now,
      updatedAt: now
    };
  }

  function newAttempt(attemptId = newAttemptId()) {
    const now = new Date();
    return {
      attemptId,
      receivedAt: now,
      updatedAt: now,
      processingStatus: "received",
      inputDigest: "a".repeat(64),
      inputSizeBytes: 10,
      job: { state: "queued", attemptCount: 0, availableAt: now }
    };
  }

  function newDaily(userId, localDate, attempts) {
    const historyPurgeAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    return {
      _id: new ObjectId(),
      schemaVersion: 1,
      userId,
      localDate,
      attempts,
      purgeAt: historyPurgeAt,
      historyPurgeAt
    };
  }

  const runId = new ObjectId().toHexString();
  const user = newUser(`smoke-${runId}@example.invalid`);
  db.users.insertOne(user);
  check(db.users.countDocuments({ _id: user._id }) === 1, "accepts a valid user");

  expectError(121, () => db.users.insertOne({ _id: new ObjectId() }), "rejects a user missing required fields");
  expectError(11000, () => db.users.insertOne(newUser(user.emailNormalized)), "enforces unique normalized email");
  db.users.insertOne(newUser(`admin-a-${runId}@example.invalid`, "admin"));
  expectError(
    11000,
    () => db.users.insertOne(newUser(`admin-b-${runId}@example.invalid`, "admin")),
    "allows at most one admin"
  );

  const firstAttempt = newAttempt();
  db.daily_analyses.insertOne(newDaily(user._id, "2026-11-03", [firstAttempt]));
  check(db.daily_analyses.countDocuments({ userId: user._id }) === 1, "accepts a valid daily analysis");
  expectError(
    11000,
    () => db.daily_analyses.insertOne(newDaily(user._id, "2026-11-03", [newAttempt()])),
    "enforces one daily document per user/date"
  );
  expectError(
    11000,
    () => db.daily_analyses.insertOne(newDaily(new ObjectId(), "2026-11-04", [firstAttempt])),
    "enforces globally unique attempt IDs across documents"
  );
  const sixAttempts = Array.from({ length: 6 }, () => newAttempt());
  expectError(
    121,
    () => db.daily_analyses.insertOne(newDaily(new ObjectId(), "2026-11-05", sixAttempts)),
    "rejects more than five attempts in a daily document"
  );

  const duplicateId = newAttempt();
  db.daily_analyses.insertOne(newDaily(new ObjectId(), "2026-11-06", [duplicateId, duplicateId]));
  check(
    true,
    "documents the multikey limitation: duplicate attempt IDs inside one document require an API guard"
  );

  const checkedAt = new Date();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const cacheEntry = {
    _id: new ObjectId(),
    schemaVersion: 1,
    keyType: "url",
    normalizedKey: `https://smoke-${runId}.example.invalid/`,
    sources: [{ sourceName: "test", status: "checked", checkedAt, expiresAt }],
    updatedAt: checkedAt,
    purgeAt: expiresAt
  };
  db.reputation_cache.insertOne(cacheEntry);
  check(db.reputation_cache.countDocuments({ _id: cacheEntry._id }) === 1, "accepts a valid reputation cache entry");
  expectError(
    121,
    () => db.reputation_cache.insertOne({ ...cacheEntry, _id: new ObjectId(), keyType: "invalid" }),
    "rejects an invalid reputation cache key type"
  );
  expectError(
    11000,
    () => db.reputation_cache.insertOne({ ...cacheEntry, _id: new ObjectId() }),
    "enforces unique reputation cache type/key"
  );

  const auditEvent = {
    _id: new ObjectId(),
    schemaVersion: 1,
    occurredAt: checkedAt,
    purgeAt: expiresAt,
    eventType: "analysis.accepted"
  };
  db.security_audit_events.insertOne(auditEvent);
  check(db.security_audit_events.countDocuments({ _id: auditEvent._id }) === 1, "accepts a valid minimal audit event");
  expectError(
    121,
    () => db.security_audit_events.insertOne({ ...auditEvent, _id: new ObjectId(), eventType: "unknown.event" }),
    "rejects an audit event outside the enum"
  );

  const token = {
    _id: new ObjectId(),
    schemaVersion: 1,
    userId: user._id,
    tokenHash: "b".repeat(64),
    familyId: "00000000-0000-4000-8000-000000000001",
    isRevoked: false,
    createdAt: checkedAt,
    expiresAt
  };
  db.refresh_tokens.insertOne(token);
  check(db.refresh_tokens.countDocuments({ _id: token._id }) === 1, "accepts a valid refresh token hash/family");
  expectError(
    121,
    () => db.refresh_tokens.insertOne({ ...token, _id: new ObjectId(), tokenHash: "not-a-hash" }),
    "rejects an invalid refresh token hash"
  );
  expectError(
    11000,
    () => db.refresh_tokens.insertOne({ ...token, _id: new ObjectId() }),
    "enforces unique refresh token hashes"
  );

  const ttlIndexes = [
    ["daily_analyses", "ttl_daily_analyses_purge_at"],
    ["reputation_cache", "ttl_reputation_cache_purge_at"],
    ["security_audit_events", "ttl_audit_purge_at"],
    ["refresh_tokens", "ttl_refresh_tokens_expires_at"]
  ];
  for (const [collectionName, indexName] of ttlIndexes) {
    const index = db.getCollection(collectionName).getIndexes().find((item) => item.name === indexName);
    check(index && index.expireAfterSeconds === 0, `has TTL index ${indexName}`);
  }

  const capacity = db.analysis_queue_capacity.findOne({ _id: "global" });
  check(capacity?.pendingCount === 0 && capacity?.maxPending === 1000, "has global queue capacity singleton with exact zero pending baseline");

  print(`MongoDB ${version}: ${passed} smoke assertions passed in ${databaseName}.`);
})();
