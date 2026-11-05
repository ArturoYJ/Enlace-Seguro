// Extend existing daily-analysis documents to the approved 366-day history TTL.
// Stop API admission/workers before applying. Forward-only and safe to rerun.
(function extendAnalysisHistoryRetention() {
  if (!globalThis.EnlaceSeguroExpectedDb || typeof globalThis.EnlaceSeguroExpectedDb !== 'string') {
    throw new Error('Set globalThis.EnlaceSeguroExpectedDb to the intended database before loading migration 006.');
  }
  if (db.getName() !== globalThis.EnlaceSeguroExpectedDb) {
    throw new Error(`Connected database '${db.getName()}' does not match the explicit target.`);
  }
  if (['admin', 'config', 'local'].includes(db.getName())) {
    throw new Error('Refusing to migrate a MongoDB system database.');
  }

  const info = db.getCollectionInfos({ name: 'daily_analyses' })[0];
  const schema = info?.options?.validator?.$jsonSchema;
  const strict = info?.options?.validationLevel === 'strict' && info?.options?.validationAction === 'error';
  if (!strict || schema?.properties?.historyPurgeAt?.bsonType !== 'date' ||
      schema?.properties?.attempts?.bsonType !== 'array' || !schema.properties.attempts.items?.properties?.receivedAt) {
    throw new Error("Existing 'daily_analyses' validator is not the recognized strict retention baseline; apply migrations 001-005 first.");
  }

  const malformed = db.daily_analyses.countDocuments({
    $or: [
      { historyPurgeAt: { $not: { $type: 'date' } } },
      { attempts: { $size: 0 } },
      { 'attempts.0.receivedAt': { $not: { $type: 'date' } } }
    ]
  });
  if (malformed > 0) {
    throw new Error(`Found ${malformed} daily-analysis documents without a usable retention anchor; refusing partial extension.`);
  }

  const activeJobs = {
    $gt: [
      {
        $size: {
          $filter: {
            input: '$attempts',
            as: 'attempt',
            cond: { $in: ['$$attempt.job.state', ['queued', 'leased']] }
          }
        }
      },
      0
    ]
  };
  const targetFromLatestAttempt = {
    $dateAdd: {
      startDate: { $max: '$attempts.receivedAt' },
      unit: 'day',
      amount: 366
    }
  };

  db.daily_analyses.updateMany({}, [{
    $set: {
      historyPurgeAt: { $max: ['$historyPurgeAt', targetFromLatestAttempt] },
      purgeAt: {
        $cond: [
          activeJobs,
          '$$REMOVE',
          { $max: ['$historyPurgeAt', targetFromLatestAttempt] }
        ]
      }
    }
  }]);

  print(`Migration 006 extended daily-analysis history to 366 days in '${db.getName()}'.`);
})();
