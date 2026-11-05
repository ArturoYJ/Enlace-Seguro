// Requires migration 005. Runs only against the disposable MongoDB integration DB.
if (!globalThis.EnlaceSeguroExpectedDb || db.getName() !== globalThis.EnlaceSeguroExpectedDb) {
  throw new Error('Set EnlaceSeguroExpectedDb to the current disposable test DB before running this test.');
}

const dayMs = 24 * 60 * 60 * 1000;
const now = new Date();
const firstAttemptAt = new Date(now.getTime() - 30 * dayMs);
const latestAttemptAt = new Date(firstAttemptAt.getTime() + 12 * 60 * 60 * 1000);
const oldExpiry = new Date(firstAttemptAt.getTime() + 365 * dayMs);
const uuidV4 = () => {
  const hex = new ObjectId().toHexString() + new ObjectId().toHexString().slice(0, 8);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const terminalId = new ObjectId();
const activeId = new ObjectId();
const userId = new ObjectId();
const baseAttempt = {
  attemptId: uuidV4(),
  receivedAt: firstAttemptAt,
  updatedAt: firstAttemptAt,
  completedAt: firstAttemptAt,
  processingStatus: 'completed',
  inputDigest: 'a'.repeat(64),
  inputSizeBytes: 1,
  job: { state: 'completed', attemptCount: 1, availableAt: firstAttemptAt }
};
const laterAttempt = { ...baseAttempt, attemptId: uuidV4(), receivedAt: latestAttemptAt, updatedAt: latestAttemptAt };
const activeAttempt = {
  ...baseAttempt,
  attemptId: uuidV4(),
  processingStatus: 'processing',
  job: {
    state: 'leased',
    attemptCount: 1,
    availableAt: firstAttemptAt,
    leaseOwner: 'migration-test-worker',
    leaseToken: uuidV4(),
    leaseExpiresAt: new Date(now.getTime() + 60_000)
  }
};
delete activeAttempt.completedAt;

db.daily_analyses.insertMany([
  {
    _id: terminalId,
    schemaVersion: 1,
    userId,
    localDate: '2026-10-05',
    attempts: [baseAttempt, laterAttempt],
    historyPurgeAt: oldExpiry,
    purgeAt: oldExpiry
  },
  {
    _id: activeId,
    schemaVersion: 1,
    userId: new ObjectId(),
    localDate: '2026-10-05',
    attempts: [activeAttempt],
    historyPurgeAt: oldExpiry
  }
]);

globalThis.EnlaceSeguroExpectedDb = db.getName();
load('database/migrations/006_extend_analysis_history_retention_366_days.js');
const expectedExpiry = new Date(latestAttemptAt.getTime() + 366 * dayMs);
const migratedTerminal = db.daily_analyses.findOne({ _id: terminalId });
const migratedActive = db.daily_analyses.findOne({ _id: activeId });
if (migratedTerminal.historyPurgeAt.getTime() !== expectedExpiry.getTime() || migratedTerminal.purgeAt.getTime() !== expectedExpiry.getTime()) {
  print('Migration 006 terminal fixture after update:');
  printjson(migratedTerminal);
  throw new Error(`Migration 006 terminal expiry mismatch: expected=${expectedExpiry.toISOString()} history=${String(migratedTerminal.historyPurgeAt)} purge=${String(migratedTerminal.purgeAt)}`);
}
const expectedActiveExpiry = new Date(firstAttemptAt.getTime() + 366 * dayMs);
if (migratedActive.historyPurgeAt.getTime() !== expectedActiveExpiry.getTime() || migratedActive.purgeAt !== undefined) {
  throw new Error('Migration 006 did not preserve active jobs without a TTL field.');
}

load('database/migrations/006_extend_analysis_history_retention_366_days.js');
const repeated = db.daily_analyses.findOne({ _id: terminalId });
if (repeated.historyPurgeAt.getTime() !== expectedExpiry.getTime() || repeated.purgeAt.getTime() !== expectedExpiry.getTime()) {
  throw new Error('Migration 006 is not idempotent.');
}

db.daily_analyses.deleteMany({ _id: { $in: [terminalId, activeId] } });
print('PASS: migration 006 extends existing history to 366 days, preserves active jobs, and is idempotent.');
