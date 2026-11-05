// Run only after the bootstrap in a disposable MongoDB 8.0 test database.
// This script performs writes in a disposable database; accepted fixtures are immediately removed.
(function runMongoValidationMatrix() {
  const databaseName = db.getName();
  const version = db.version();
  if (!/^enlaceseguro_test_[a-z0-9_-]+$/.test(databaseName)) {
    throw new Error(`Refusing writes to non-test database '${databaseName}'.`);
  }
  if (!/^8\.0\./.test(version)) {
    throw new Error(`Expected MongoDB 8.0.x, got ${version}.`);
  }

  const expectedCollections = [
    'analysis_queue_capacity',
    'daily_analyses',
    'login_rate_limit_buckets',
    'reputation_cache',
    'refresh_tokens',
    'security_audit_events',
    'users'
  ].sort();
  const actualCollections = db.getCollectionNames().sort();
  if (JSON.stringify(actualCollections) !== JSON.stringify(expectedCollections)) {
    throw new Error(`Expected bootstrapped test collections; got ${JSON.stringify(actualCollections)}.`);
  }

  let passed = 0;
  function expectValidationReject(collectionName, document, message) {
    try {
      db.getCollection(collectionName).insertOne(document);
    } catch (error) {
      if (error.code === 121) {
        passed += 1;
        print(`PASS: ${message}`);
        return;
      }
      throw new Error(`${message}: expected validation error 121, got ${error.code}: ${error.message}`);
    }
    throw new Error(`${message}: invalid document unexpectedly inserted`);
  }

  function expectValidationAccept(collectionName, document, message) {
    try {
      db.getCollection(collectionName).insertOne(document);
    } catch (error) {
      throw new Error(`${message}: expected valid document, got ${error.code}: ${error.message}`);
    }
    db.getCollection(collectionName).deleteOne({ _id: document._id });
    passed += 1;
    print(`PASS: ${message}`);
  }

  function newId() {
    return new ObjectId();
  }
  function newAttemptId() {
    return `10000000-0000-4000-8000-${newId().toHexString().slice(-12)}`;
  }
  function newUser() {
    const now = new Date();
    return {
      _id: newId(), schemaVersion: 1,
      emailNormalized: `matrix-${newId().toHexString()}@example.invalid`,
      passwordHash: 'test-hash-only', role: 'usuario', accountStatus: 'active',
      createdAt: now, updatedAt: now
    };
  }
  function newAttempt() {
    const now = new Date();
    return {
      attemptId: newAttemptId(), receivedAt: now, updatedAt: now,
      processingStatus: 'received', inputDigest: 'a'.repeat(64), inputSizeBytes: 10,
      job: { state: 'queued', attemptCount: 0, availableAt: now }
    };
  }
  function newDaily() {
    const historyPurgeAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    return {
      _id: newId(), schemaVersion: 1, userId: newId(), localDate: '2026-11-03',
      attempts: [newAttempt()], purgeAt: historyPurgeAt, historyPurgeAt
    };
  }
  function newSourceResult() {
    const now = new Date();
    return { sourceName: 'matrix', status: 'checked', checkedAt: now, expiresAt: new Date(now.getTime() + 60_000) };
  }
  function newCache() {
    const now = new Date();
    return {
      _id: newId(), schemaVersion: 1, keyType: 'url',
      normalizedKey: `https://matrix-${newId().toHexString()}.example.invalid/`,
      sources: [newSourceResult()], updatedAt: now,
      purgeAt: new Date(now.getTime() + 60_000)
    };
  }
  function newAudit() {
    const now = new Date();
    return {
      _id: newId(), schemaVersion: 1, occurredAt: now,
      purgeAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      eventType: 'analysis.accepted'
    };
  }
  function newRefreshToken() {
    const now = new Date();
    return {
      _id: newId(), schemaVersion: 1, userId: newId(), tokenHash: 'b'.repeat(64),
      familyId: newAttemptId(), isRevoked: false, createdAt: now,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    };
  }

  // users: allowlists, required fields, schema version, enums, and BSON types.
  let user = newUser(); user.unexpected = true;
  expectValidationReject('users', user, 'users rejects an unknown root property');
  user = newUser(); user.schemaVersion = 2;
  expectValidationReject('users', user, 'users rejects schemaVersion other than 1');
  user = newUser(); delete user.passwordHash;
  expectValidationReject('users', user, 'users requires passwordHash');
  user = newUser(); user.role = 'operator';
  expectValidationReject('users', user, 'users rejects role outside enum');
  user = newUser(); user.accountStatus = 'pending';
  expectValidationReject('users', user, 'users rejects accountStatus outside enum');
  user = newUser(); user.createdAt = new Date().toISOString();
  expectValidationReject('users', user, 'users rejects ISO string instead of BSON date');

  // daily_analyses: parent and embedded allowlists, UUID/status/digest/size,
  // and bounded evidence arrays/strings. The six-attempt maximum is covered by smoke.
  let daily = newDaily(); daily.unexpected = true;
  expectValidationReject('daily_analyses', daily, 'daily_analyses rejects an unknown root property');
  daily = newDaily(); daily.schemaVersion = '1';
  expectValidationReject('daily_analyses', daily, 'daily_analyses rejects non-numeric schemaVersion');
  daily = newDaily(); delete daily.historyPurgeAt;
  expectValidationReject('daily_analyses', daily, 'daily_analyses requires immutable historyPurgeAt');
  daily = newDaily(); delete daily.purgeAt;
  expectValidationAccept('daily_analyses', daily, 'daily_analyses allows omitted TTL field for pending jobs');
  daily = newDaily(); daily.localDate = new Date().toISOString();
  expectValidationReject('daily_analyses', daily, 'daily_analyses rejects invalid localDate format');
  daily = newDaily(); daily.attempts[0].unexpected = true;
  expectValidationReject('daily_analyses', daily, 'daily_analyses rejects an unknown attempt property');
  daily = newDaily(); daily.attempts[0].attemptId = 'not-a-v4-uuid';
  expectValidationReject('daily_analyses', daily, 'daily_analyses rejects non-canonical attemptId');
  daily = newDaily(); daily.attempts[0].processingStatus = 'queued';
  expectValidationReject('daily_analyses', daily, 'daily_analyses rejects unknown processing status');
  daily = newDaily(); daily.attempts[0].inputDigest = 'A'.repeat(64);
  expectValidationReject('daily_analyses', daily, 'daily_analyses rejects non-lowercase SHA-256 digest');
  daily = newDaily(); daily.attempts[0].inputSizeBytes = -1;
  expectValidationReject('daily_analyses', daily, 'daily_analyses rejects negative inputSizeBytes');
  daily = newDaily(); delete daily.attempts[0].job;
  expectValidationReject('daily_analyses', daily, 'daily_analyses requires durable job metadata');
  daily = newDaily(); daily.attempts[0].job.state = 'waiting';
  expectValidationReject('daily_analyses', daily, 'daily_analyses rejects unknown job state');
  daily = newDaily(); daily.attempts[0].job.attemptCount = 11;
  expectValidationReject('daily_analyses', daily, 'daily_analyses caps job retry attempts at ten');
  daily = newDaily(); daily.attempts[0].job.leaseToken = 'not-a-uuid';
  expectValidationReject('daily_analyses', daily, 'daily_analyses validates lease fencing tokens');
  daily = newDaily(); daily.attempts[0].submittedInput = 'x'.repeat(8193);
  expectValidationReject('daily_analyses', daily, 'daily_analyses enforces submittedInput maximum length');
  daily = newDaily(); daily.attempts[0].submittedInputEncrypted = {
    algorithm: 'aes-256-gcm', keyVersion: 'v1', iv: 'A'.repeat(16), authTag: 'A'.repeat(22), ciphertext: 'A'.repeat(87382)
  };
  expectValidationAccept('daily_analyses', daily, 'daily_analyses accepts encrypted input at the 64 KiB ciphertext bound');
  daily = newDaily(); daily.attempts[0].submittedInputEncrypted = {
    algorithm: 'aes-256-gcm', keyVersion: 'v1', iv: 'A'.repeat(16), ciphertext: 'AA'
  };
  expectValidationReject('daily_analyses', daily, 'daily_analyses requires all encrypted input fields');
  daily = newDaily(); daily.attempts[0].submittedInputEncrypted = {
    algorithm: 'aes-256-gcm', keyVersion: 'v1', iv: 'A'.repeat(16), authTag: 'A'.repeat(22), ciphertext: 'AA', raw: 'plaintext'
  };
  expectValidationReject('daily_analyses', daily, 'daily_analyses rejects unknown encrypted input properties');
  daily = newDaily(); daily.attempts[0].analysis = { verdict: 'safe', unexpected: true };
  expectValidationReject('daily_analyses', daily, 'daily_analyses rejects unknown analysis properties');
  daily = newDaily(); daily.attempts[0].analysis = { verdict: 'peligroso', reasons: Array.from({ length: 11 }, () => 'reason') };
  expectValidationReject('daily_analyses', daily, 'daily_analyses enforces maximum reasons');
  daily = newDaily(); daily.attempts[0].analysis = { verdict: 'peligroso', signals: Array.from({ length: 51 }, () => 'signal') };
  expectValidationReject('daily_analyses', daily, 'daily_analyses enforces maximum signals');
  daily = newDaily(); daily.attempts[0].analysis = { verdict: 'peligroso', sourceResults: Array.from({ length: 5 }, newSourceResult) };
  expectValidationReject('daily_analyses', daily, 'daily_analyses enforces maximum sourceResults');
  daily = newDaily(); daily.attempts[0].analysis = { verdict: 'peligroso', sourceFailures: [{ sourceName: 'matrix', reasonCode: 'failed', arbitrary: true }] };
  expectValidationReject('daily_analyses', daily, 'daily_analyses rejects unknown sourceFailures properties');
  daily = newDaily(); daily.attempts[0].analysis = { verdict: 'peligroso', redirects: Array.from({ length: 11 }, () => 'https://example.invalid') };
  expectValidationReject('daily_analyses', daily, 'daily_analyses enforces maximum redirects');

  // reputation_cache: key enum, required BSON dates, source array limits and allowlists.
  let cache = newCache(); cache.keyType = 'host';
  expectValidationReject('reputation_cache', cache, 'reputation_cache rejects keyType outside enum');
  cache = newCache(); cache.unexpected = true;
  expectValidationReject('reputation_cache', cache, 'reputation_cache rejects an unknown root property');
  cache = newCache(); cache.schemaVersion = 0;
  expectValidationReject('reputation_cache', cache, 'reputation_cache rejects schemaVersion other than 1');
  cache = newCache(); cache.updatedAt = new Date().toISOString();
  expectValidationReject('reputation_cache', cache, 'reputation_cache requires BSON date updatedAt');
  cache = newCache(); cache.sources = [];
  expectValidationReject('reputation_cache', cache, 'reputation_cache requires at least one source result');
  cache = newCache(); cache.sources = Array.from({ length: 5 }, newSourceResult);
  expectValidationReject('reputation_cache', cache, 'reputation_cache enforces maximum source count');
  cache = newCache(); cache.sources[0].unexpected = true;
  expectValidationReject('reputation_cache', cache, 'reputation_cache rejects unknown source properties');

  // security_audit_events: event/outcome enums, metadata allowlist/count/length and types.
  let audit = newAudit(); audit.unexpected = true;
  expectValidationReject('security_audit_events', audit, 'security_audit_events rejects an unknown root property');
  audit = newAudit(); audit.schemaVersion = 2;
  expectValidationReject('security_audit_events', audit, 'security_audit_events rejects schemaVersion other than 1');
  audit = newAudit(); audit.occurredAt = new Date().toISOString();
  expectValidationReject('security_audit_events', audit, 'security_audit_events requires BSON date occurredAt');
  audit = newAudit(); audit.eventType = 'unknown.event';
  expectValidationReject('security_audit_events', audit, 'security_audit_events rejects eventType outside catalog');
  audit = newAudit(); audit.outcome = 'unknown';
  expectValidationReject('security_audit_events', audit, 'security_audit_events rejects outcome outside enum');
  audit = newAudit(); audit.metadata = { arbitrary: true };
  expectValidationReject('security_audit_events', audit, 'security_audit_events rejects unknown metadata properties');
  audit = newAudit(); audit.metadata = { reasonCode: 'x'.repeat(65) };
  expectValidationReject('security_audit_events', audit, 'security_audit_events enforces metadata string maximum');
  audit = newAudit(); audit.metadata = { httpStatus: 600 };
  expectValidationReject('security_audit_events', audit, 'security_audit_events rejects out-of-range httpStatus');
  audit = newAudit(); audit.metadata = { httpStatus: 200.5 };
  expectValidationReject('security_audit_events', audit, 'security_audit_events rejects non-integer httpStatus');

  // refresh_tokens: required fields, version/types, token and family formats, allowlist.
  let token = newRefreshToken(); token.schemaVersion = '1';
  expectValidationReject('refresh_tokens', token, 'refresh_tokens rejects non-numeric schemaVersion');
  token = newRefreshToken(); delete token.expiresAt;
  expectValidationReject('refresh_tokens', token, 'refresh_tokens requires expiresAt');
  token = newRefreshToken(); token.tokenHash = 'B'.repeat(64);
  expectValidationReject('refresh_tokens', token, 'refresh_tokens rejects non-lowercase token hash');
  token = newRefreshToken(); token.familyId = 'not-a-v4-uuid';
  expectValidationReject('refresh_tokens', token, 'refresh_tokens rejects non-canonical familyId');
  token = newRefreshToken(); token.isRevoked = 'false';
  expectValidationReject('refresh_tokens', token, 'refresh_tokens requires boolean isRevoked');
  token = newRefreshToken(); token.unexpected = true;
  expectValidationReject('refresh_tokens', token, 'refresh_tokens rejects unknown root property');

  const capacity = { _id: 'global', schemaVersion: 1, pendingCount: 0, maxPending: 1000, updatedAt: new Date() };
  expectValidationReject('analysis_queue_capacity', { ...capacity, _id: 'other' }, 'queue capacity rejects non-singleton ID');
  expectValidationReject('analysis_queue_capacity', { ...capacity, pendingCount: -1 }, 'queue capacity rejects negative pending count');
  expectValidationReject('analysis_queue_capacity', { ...capacity, maxPending: 0 }, 'queue capacity rejects zero maximum');

  print(`MongoDB ${version}: ${passed} additional validation-matrix assertions passed in ${databaseName}.`);
})();
