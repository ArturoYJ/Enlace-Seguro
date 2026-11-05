// Emulates the strict schema from migration 003, then verifies migration 004 is forward-only and recoverable.
(function testDurableJobMigrationFrom003() {
  const databaseName = db.getName();
  if (!/^enlaceseguro_test_[a-z0-9_-]+$/.test(databaseName)) {
    throw new Error(`Refusing migration fixtures in non-test database '${databaseName}'.`);
  }
  if (globalThis.EnlaceSeguroExpectedDb !== databaseName) throw new Error('Expected database guard is missing.');

  const collection = db.getCollection('daily_analyses');
  const oldValidator = JSON.parse(JSON.stringify(globalThis.EnlaceSeguroValidators.daily_analyses));
  oldValidator.$jsonSchema.required = oldValidator.$jsonSchema.required.filter((field) => field !== 'historyPurgeAt');
  oldValidator.$jsonSchema.required.push('purgeAt');
  delete oldValidator.$jsonSchema.properties.historyPurgeAt;
  const attemptSchema = oldValidator.$jsonSchema.properties.attempts.items;
  attemptSchema.required = attemptSchema.required.filter((field) => field !== 'job');
  delete attemptSchema.properties.job;
  const altered = db.runCommand({
    collMod: 'daily_analyses', validator: oldValidator, validationLevel: 'strict', validationAction: 'error'
  });
  if (altered.ok !== 1) throw new Error('Could not create the migration 003 simulation.');
  if (collection.getIndexes().some((index) => index.name === 'ix_daily_analyses_job_claim')) {
    collection.dropIndex('ix_daily_analyses_job_claim');
  }

  const now = new Date();
  const userId = new ObjectId();
  const attempts = [
    { attemptId: '20000000-0000-4000-8000-000000000001', processingStatus: 'received', submittedInput: 'https://queued.example.invalid' },
    { attemptId: '20000000-0000-4000-8000-000000000002', processingStatus: 'completed', submittedInput: 'https://done.example.invalid' },
    { attemptId: '20000000-0000-4000-8000-000000000003', processingStatus: 'failed' },
    { attemptId: '20000000-0000-4000-8000-000000000004', processingStatus: 'processing' }
  ].map((attempt) => ({
    attemptId: attempt.attemptId,
    receivedAt: now,
    updatedAt: now,
    processingStatus: attempt.processingStatus,
    ...(attempt.submittedInput ? { submittedInput: attempt.submittedInput } : {}),
    inputDigest: 'd'.repeat(64),
    inputSizeBytes: attempt.submittedInput ? attempt.submittedInput.length : 0
  }));
  collection.insertOne({
    _id: new ObjectId(), schemaVersion: 1, userId, localDate: '2026-11-03', attempts,
    purgeAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
  });

  load('database/migrations/004_durable_analysis_jobs.js');
  load('database/migrations/004_durable_analysis_jobs.js');
  const migrated = collection.findOne({ userId });
  if (!migrated || migrated.attempts[0].job?.state !== 'queued' || migrated.attempts[0].job?.attemptCount !== 0) {
    throw new Error('Migration 004 did not queue the legacy received attempt.');
  }
  if (migrated.attempts[1].job?.state !== 'completed' || migrated.attempts[2].job?.state !== 'dead') {
    throw new Error('Migration 004 did not keep legacy terminal attempts out of the queue.');
  }
  if (migrated.attempts[3].job?.state !== 'dead' || migrated.attempts[3].processingStatus !== 'inconclusive' || !migrated.attempts[3].completedAt || migrated.attempts[3].job?.lastFailureCode !== 'input_unavailable') {
    throw new Error('Migration 004 did not terminalize a legacy in-flight attempt whose input was not retained.');
  }
  if (!collection.getIndexes().some((index) => index.name === 'ix_daily_analyses_job_claim')) {
    throw new Error('Migration 004 did not create the job claim index.');
  }
  const info = db.getCollectionInfos({ name: 'daily_analyses' })[0];
  if (info.options.validationLevel !== 'strict' || info.options.validationAction !== 'error') {
    throw new Error('Migration 004 did not preserve strict validation.');
  }
  print('PASS: migration 004 safely upgraded a strict 003 database and is idempotent.');

  globalThis.EnlaceSeguroAnalysisJobMaxPending = 1000;
  load('database/migrations/005_analysis_queue_capacity.js');
  load('database/migrations/005_analysis_queue_capacity.js');
  const migratedWithCapacity = collection.findOne({ userId });
  const capacity = db.analysis_queue_capacity.findOne({ _id: 'global' });
  if (!migratedWithCapacity?.historyPurgeAt || migratedWithCapacity.purgeAt !== undefined ||
      capacity?.pendingCount !== 1 || capacity?.maxPending !== 1000) {
    throw new Error('Migration 005 did not preserve TTL and seed the global count for the legacy queued job.');
  }
  print('PASS: migration 005 preserves TTL for active legacy jobs and seeds an exact counter idempotently.');
})();
