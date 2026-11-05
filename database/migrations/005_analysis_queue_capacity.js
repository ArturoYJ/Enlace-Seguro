// Add an exact global capacity counter for embedded queued/leased analysis jobs.
// Run with API/workers stopped and apply only after migration 004.
load('database/schema/collection-validators.js');

(function addGlobalAnalysisQueueCapacity() {
  if (!globalThis.EnlaceSeguroExpectedDb || typeof globalThis.EnlaceSeguroExpectedDb !== 'string') {
    throw new Error('Set globalThis.EnlaceSeguroExpectedDb to the intended database before loading migration 005.');
  }
  if (db.getName() !== globalThis.EnlaceSeguroExpectedDb) {
    throw new Error(`Connected database '${db.getName()}' does not match the explicit target.`);
  }
  if (['admin', 'config', 'local'].includes(db.getName())) {
    throw new Error('Refusing to migrate a MongoDB system database.');
  }
  const maxPending = globalThis.EnlaceSeguroAnalysisJobMaxPending;
  if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 1_000_000_000) {
    throw new Error('Set globalThis.EnlaceSeguroAnalysisJobMaxPending to an integer from 1 to 1000000000.');
  }

  const dailyInfo = db.getCollectionInfos({ name: 'daily_analyses' })[0];
  if (!dailyInfo) throw new Error("Required 'daily_analyses' collection is missing; apply bootstrap 001 first.");
  const currentSchema = dailyInfo.options?.validator?.$jsonSchema;
  const currentAttemptProperties = currentSchema?.properties?.attempts?.items?.properties;
  const strictDaily = dailyInfo.options?.validationLevel === 'strict' && dailyInfo.options?.validationAction === 'error';
  const hasDurableJobs = Array.isArray(currentAttemptProperties?.job?.properties?.state?.enum) &&
    currentAttemptProperties.job.properties.state.enum.indexOf('leased') >= 0;
  if (!strictDaily || currentSchema?.additionalProperties !== false || !hasDurableJobs) {
    throw new Error("Existing 'daily_analyses' validator is not the recognized strict 004 baseline; refusing migration.");
  }

  const capacityValidator = globalThis.EnlaceSeguroValidators?.analysis_queue_capacity;
  const desiredDailyValidator = globalThis.EnlaceSeguroValidators?.daily_analyses;
  if (!capacityValidator?.$jsonSchema || !desiredDailyValidator?.$jsonSchema?.properties?.historyPurgeAt) {
    throw new Error('Load the current collection validators before applying migration 005.');
  }

  const pendingCount = db.daily_analyses.aggregate([
    { $unwind: '$attempts' },
    { $match: { 'attempts.job.state': { $in: ['queued', 'leased'] } } },
    { $count: 'pendingCount' }
  ]).toArray()[0]?.pendingCount ?? 0;
  if (pendingCount > maxPending) {
    throw new Error(`Existing pending jobs (${pendingCount}) exceed configured ANALYSIS_JOB_MAX_PENDING (${maxPending}); refusing to delete or demote work.`);
  }

  const capacityCollectionName = 'analysis_queue_capacity';
  const capacityInfo = db.getCollectionInfos({ name: capacityCollectionName })[0];
  if (capacityInfo) {
    const strictCapacity = capacityInfo.options?.validationLevel === 'strict' && capacityInfo.options?.validationAction === 'error';
    const existingValidator = capacityInfo.options?.validator?.$jsonSchema;
    if (!strictCapacity || JSON.stringify(existingValidator) !== JSON.stringify(capacityValidator.$jsonSchema)) {
      throw new Error(`Existing '${capacityCollectionName}' collection is partial or incompatible; refusing to replace it.`);
    }
  }

  const currentRequired = Array.isArray(currentSchema?.required) ? currentSchema.required : [];
  const hasRetentionField = currentSchema?.properties?.historyPurgeAt?.bsonType === 'date' &&
    currentRequired.includes('historyPurgeAt');
  if (!hasRetentionField) {
    const result = db.runCommand({
      collMod: 'daily_analyses',
      validator: desiredDailyValidator,
      validationLevel: 'strict',
      validationAction: 'error'
    });
    if (result.ok !== 1) throw new Error("Migration 005 failed to update 'daily_analyses' validator.");
  }

  const activeJobsExpression = {
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
  db.daily_analyses.updateMany({}, [{
    $set: {
      historyPurgeAt: { $ifNull: ['$historyPurgeAt', '$purgeAt'] },
      purgeAt: {
        $cond: [activeJobsExpression, '$$REMOVE', { $ifNull: ['$purgeAt', '$historyPurgeAt'] }]
      }
    }
  }], { bypassDocumentValidation: true });

  if (!capacityInfo) {
    db.createCollection(capacityCollectionName, {
      validator: capacityValidator,
      validationLevel: 'strict',
      validationAction: 'error'
    });
  }

  const capacityCollection = db.getCollection(capacityCollectionName);
  const singleton = capacityCollection.findOne({ _id: 'global' });
  if (!singleton) {
    if (capacityCollection.countDocuments({}) !== 0) {
      throw new Error(`Existing '${capacityCollectionName}' has unexpected documents; refusing to seed singleton.`);
    }
    capacityCollection.insertOne({
      _id: 'global',
      schemaVersion: 1,
      pendingCount,
      maxPending,
      updatedAt: new Date()
    });
  } else if (capacityCollection.countDocuments({}) !== 1 || singleton.pendingCount !== pendingCount || singleton.maxPending !== maxPending) {
    throw new Error(`Existing queue counter/config drift: singleton pending=${singleton.pendingCount}, max=${singleton.maxPending}; aggregate pending=${pendingCount}, configured max=${maxPending}. Use the controlled reconciliation runbook.`);
  }

  print(`Migration 005 created global queue capacity (${pendingCount}/${maxPending}) in '${db.getName()}'.`);
})();
