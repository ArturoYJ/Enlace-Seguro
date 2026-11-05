// Add an embedded, provider-neutral job queue to each daily analysis attempt.
// Apply only after 003; existing terminal attempts are mapped out of the queue.
load('database/schema/collection-validators.js');

(function addDurableAnalysisJobs() {
  const collectionName = 'daily_analyses';
  const indexName = 'ix_daily_analyses_job_claim';

  if (!globalThis.EnlaceSeguroExpectedDb || typeof globalThis.EnlaceSeguroExpectedDb !== 'string') {
    throw new Error('Set globalThis.EnlaceSeguroExpectedDb to the intended database before loading migration 004.');
  }
  if (db.getName() !== globalThis.EnlaceSeguroExpectedDb) {
    throw new Error(`Connected database '${db.getName()}' does not match the explicit target.`);
  }
  if (db.getName() === 'admin' || db.getName() === 'config' || db.getName() === 'local') {
    throw new Error('Refusing to migrate a MongoDB system database.');
  }

  const collectionInfo = db.getCollectionInfos({ name: collectionName })[0];
  if (!collectionInfo) throw new Error(`Required '${collectionName}' collection is missing; apply bootstrap 001 first.`);
  const currentSchema = collectionInfo.options?.validator?.$jsonSchema;
  const currentAttemptProperties = currentSchema?.properties?.attempts?.items?.properties;
  const strictValidation = collectionInfo.options?.validationLevel === 'strict' && collectionInfo.options?.validationAction === 'error';
  if (!strictValidation || currentSchema?.additionalProperties !== false ||
      !currentAttemptProperties?.submittedInputEncrypted || !currentAttemptProperties?.processingStatus) {
    throw new Error(`Existing '${collectionName}' validator is not the recognized strict 003 baseline; refusing to replace it.`);
  }

  const desiredSchema = globalThis.EnlaceSeguroValidators?.daily_analyses?.$jsonSchema;
  const desiredJobSchema = desiredSchema?.properties?.attempts?.items?.properties?.job;
  if (!desiredJobSchema) throw new Error('Load the current collection validators before applying migration 004.');
  // The shared validator file represents the latest schema. Build the 004
  // contract by evolving the actual strict 003 schema only with job metadata;
  // fields introduced by later migrations (such as historyPurgeAt in 005)
  // must not be required prematurely.
  const durableJobSchema = JSON.parse(JSON.stringify(currentSchema));
  const durableAttempt = durableJobSchema.properties.attempts.items;
  durableAttempt.properties.job = desiredJobSchema;
  if (!durableAttempt.required.includes('job')) durableAttempt.required.push('job');
  const migrationTime = new Date();

  const currentJobSchema = currentAttemptProperties.job;
  const jobsValidatorPresent = Array.isArray(currentJobSchema?.required) &&
    currentJobSchema.required.indexOf('availableAt') >= 0 &&
    Array.isArray(currentJobSchema?.properties?.state?.enum) &&
    currentJobSchema.properties.state.enum.indexOf('leased') >= 0;
  if (!jobsValidatorPresent) {
    // Prepare documents before enforcing the new required field. Defaults keep old records recoverable.
    db.getCollection(collectionName).updateMany({}, [
      {
        $set: {
          attempts: {
            $map: {
              input: '$attempts',
              as: 'attempt',
              in: {
                $mergeObjects: [
                  '$$attempt',
                  {
                    processingStatus: {
                      $cond: [
                        {
                          $and: [
                            { $in: ['$$attempt.processingStatus', ['received', 'processing']] },
                            { $eq: [{ $type: '$$attempt.submittedInput' }, 'missing'] },
                            { $eq: [{ $type: '$$attempt.submittedInputEncrypted' }, 'missing'] }
                          ]
                        },
                        'inconclusive',
                        '$$attempt.processingStatus'
                      ]
                    },
                    completedAt: {
                      $cond: [
                        {
                          $and: [
                            { $in: ['$$attempt.processingStatus', ['received', 'processing']] },
                            { $eq: [{ $type: '$$attempt.submittedInput' }, 'missing'] },
                            { $eq: [{ $type: '$$attempt.submittedInputEncrypted' }, 'missing'] }
                          ]
                        },
                        { $ifNull: ['$$attempt.completedAt', { $literal: migrationTime }] },
                        { $ifNull: ['$$attempt.completedAt', '$$REMOVE'] }
                      ]
                    },
                    job: {
                      $ifNull: [
                        '$$attempt.job',
                        {
                          state: {
                            $switch: {
                              branches: [
                                { case: { $in: ['$$attempt.processingStatus', ['completed', 'inconclusive']] }, then: 'completed' },
                                { case: { $in: ['$$attempt.processingStatus', ['failed', 'validation_failed']] }, then: 'dead' },
                                { case: { $and: [{ $eq: [{ $type: '$$attempt.submittedInput' }, 'missing'] }, { $eq: [{ $type: '$$attempt.submittedInputEncrypted' }, 'missing'] }] }, then: 'dead' }
                              ],
                              default: 'queued'
                            }
                          },
                          attemptCount: 0,
                          availableAt: '$$attempt.receivedAt',
                          lastFailureCode: {
                            $cond: [
                              {
                                $and: [
                                  { $in: ['$$attempt.processingStatus', ['received', 'processing']] },
                                  { $eq: [{ $type: '$$attempt.submittedInput' }, 'missing'] },
                                  { $eq: [{ $type: '$$attempt.submittedInputEncrypted' }, 'missing'] }
                                ]
                              },
                              'input_unavailable',
                              '$$REMOVE'
                            ]
                          }
                        }
                      ]
                    }
                  }
                ]
              }
            }
          }
        }
      }
    ], { bypassDocumentValidation: true });

    const result = db.runCommand({
      collMod: collectionName,
      validator: { $jsonSchema: durableJobSchema },
      validationLevel: 'strict',
      validationAction: 'error'
    });
    if (result.ok !== 1) throw new Error(`Migration 004 failed to update '${collectionName}' validator.`);
  }

  const collection = db.getCollection(collectionName);
  const claimIndex = collection.getIndexes().find((index) => index.name === indexName);
  if (!claimIndex) {
    collection.createIndex(
      { 'attempts.job.state': 1, 'attempts.job.availableAt': 1, 'attempts.job.leaseExpiresAt': 1, localDate: 1 },
      { name: indexName }
    );
  } else if (claimIndex.expireAfterSeconds !== undefined) {
    throw new Error(`Existing '${indexName}' has incompatible TTL options.`);
  }

  print(`Migration 004 enabled durable embedded analysis jobs in '${db.getName()}'.`);
})();
