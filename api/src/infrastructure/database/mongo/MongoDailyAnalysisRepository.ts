import { randomUUID } from 'node:crypto';
import { ClientSession, Db, MongoClient, ObjectId, MongoServerError } from 'mongodb';
import {
  IDailyAnalysisRepository,
  AdmissionResult,
  ListUserAttemptsOptions,
  PaginatedAttemptsResult,
  AdminMetricsResult,
  UserAnalysisSummaryCounts,
  AnalysisQueueSnapshot,
  ClaimedAnalysisJob,
  RetryClaimResult
} from '../../../core/ports/IDailyAnalysisRepository.js';
import { DailyAnalysis, AttemptProps } from '../../../core/entities/Analysis.js';
import { ValidationError } from '../../../core/errors/DomainErrors.js';
import { AnalysisQueueUnavailableError } from '../../../core/errors/DomainErrors.js';
import { EncryptedAnalysisInput, IAnalysisInputCipher } from '../../../core/ports/IAnalysisInputCipher.js';
import { omitUndefinedDeep } from './omitUndefinedDeep.js';
import { getLocalDate } from '../../../core/utils/dateUtils.js';

function decodeHistoryCursor(cursor: string): { localDate: string; receivedAt: Date; attemptId: string } {
  const invalidCursor = () => new ValidationError('The analysis history cursor is invalid.', [
    { name: 'cursor', reason: 'Use the cursor returned by the previous history page.' }
  ]);

  if (cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalidCursor();

  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    if (Buffer.from(json).toString('base64url') !== cursor) throw invalidCursor();
    const decoded: unknown = JSON.parse(json);
    if (typeof decoded !== 'object' || decoded === null) throw invalidCursor();

    const value = decoded as { localDate?: unknown; receivedAt?: unknown; attemptId?: unknown };
    if (typeof value.localDate !== 'string' || typeof value.receivedAt !== 'string' || typeof value.attemptId !== 'string') {
      throw invalidCursor();
    }
    const localDate = new Date(`${value.localDate}T00:00:00.000Z`);
    const receivedAt = new Date(value.receivedAt);
    if (Number.isNaN(localDate.getTime()) || localDate.toISOString().slice(0, 10) !== value.localDate ||
        Number.isNaN(receivedAt.getTime()) || receivedAt.toISOString() !== value.receivedAt ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.attemptId)) {
      throw invalidCursor();
    }
    return { localDate: value.localDate, receivedAt, attemptId: value.attemptId };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw invalidCursor();
  }
}

interface DailyAnalysisDoc {
  _id: ObjectId;
  schemaVersion: number;
  userId: ObjectId;
  localDate: string;
  attempts: PersistedAttemptProps[];
  purgeAt?: Date;
  historyPurgeAt: Date;
}

interface AnalysisQueueCapacityDoc {
  _id: 'global';
  schemaVersion: 1;
  pendingCount: number;
  maxPending: number;
  updatedAt: Date;
}

interface PersistedAttemptProps extends Omit<AttemptProps, 'submittedInput'> {
  /** Legacy plaintext is read-only compatibility for records created before encryption. */
  submittedInput?: string;
  submittedInputEncrypted?: EncryptedAnalysisInput;
  job?: PersistedAnalysisJob;
}

interface PersistedAnalysisJob {
  state: 'queued' | 'leased' | 'completed' | 'dead';
  attemptCount: number;
  availableAt: Date;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAt?: Date;
  lastFailureCode?: string;
}

class AdmissionTransactionRejected extends Error {
  constructor(public readonly result: AdmissionResult) {
    super('Analysis admission transaction rejected.');
  }
}

const NO_PURGE_DATE = '$$REMOVE';

function withoutJobLeaseMetadata(jobExpression: unknown) {
  // $$REMOVE inside a nested $mergeObjects leaves missing-valued fields in the merged object.
  return {
    $unsetField: {
      field: 'leaseOwner',
      input: {
        $unsetField: {
          field: 'leaseToken',
          input: {
            $unsetField: {
              field: 'leaseExpiresAt',
              input: jobExpression
            }
          }
        }
      }
    }
  };
}

export class MongoDailyAnalysisRepository implements IDailyAnalysisRepository {
  constructor(
    private readonly db: Db,
    private readonly inputCipher: IAnalysisInputCipher,
    private readonly mongoClient: MongoClient,
    private readonly maxPending = 1000
  ) {
    if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 1_000_000_000) {
      throw new Error('ANALYSIS_JOB_MAX_PENDING must be an integer between 1 and 1000000000.');
    }
  }

  private get collection() {
    return this.db.collection<DailyAnalysisDoc>('daily_analyses');
  }

  private get capacityCollection() {
    return this.db.collection<AnalysisQueueCapacityDoc>('analysis_queue_capacity');
  }

  public async assertInputEncryptionReady(): Promise<void> {
    const info = await this.db.listCollections({ name: 'daily_analyses' }, { nameOnly: false }).next();
    const schema = info?.options?.validator?.$jsonSchema;
    const attemptProperties = schema?.properties?.attempts?.items?.properties;
    const encryptedInputProperties = attemptProperties?.submittedInputEncrypted?.properties;
    const jobProperties = attemptProperties?.job?.properties;
    const strictValidation = info?.options?.validationLevel === 'strict' && info?.options?.validationAction === 'error';

    if (!strictValidation || !encryptedInputProperties ||
        encryptedInputProperties.algorithm?.enum?.includes('aes-256-gcm') !== true ||
        encryptedInputProperties.keyVersion?.enum?.includes('v1') !== true ||
        encryptedInputProperties.ciphertext?.maxLength !== 87382 ||
        jobProperties?.state?.enum?.includes('leased') !== true ||
        jobProperties?.leaseToken?.maxLength !== 36) {
      throw new Error('MongoDB migrations 003 and 004 for encrypted inputs and durable jobs are required before API startup.');
    }
  }

  public async assertAnalysisQueueCapacityReady(): Promise<void> {
    const info = await this.db.listCollections({ name: 'analysis_queue_capacity' }, { nameOnly: false }).next();
    const schema = info?.options?.validator?.$jsonSchema;
    const strict = info?.options?.validationLevel === 'strict' && info?.options?.validationAction === 'error';
    const singleton = await this.capacityCollection.findOne({ _id: 'global' });
    const count = await this.capacityCollection.countDocuments({});
    if (!strict || schema?.properties?.pendingCount?.minimum !== 0 || schema?.properties?.maxPending?.minimum !== 1 ||
        count !== 1 || !singleton || singleton.maxPending !== this.maxPending ||
        !Number.isSafeInteger(singleton.pendingCount) || singleton.pendingCount < 0 || singleton.pendingCount > singleton.maxPending) {
      throw new Error('MongoDB migration 005 and a matching global analysis queue capacity singleton are required before API startup.');
    }
  }

  public async admitAttemptAtomic(
    userId: string,
    localDate: string,
    attempt: AttemptProps,
    maxAttempts = 5
  ): Promise<AdmissionResult> {
    if (!ObjectId.isValid(userId)) {
      return { success: false, reason: 'quota_exceeded' };
    }

    const userObjectId = new ObjectId(userId);
    const purgeAt = new Date(attempt.receivedAt.getTime() + 366 * 24 * 60 * 60 * 1000);
    const persistedAttempt = this.encodeAttempt(userId, localDate, attempt);
    const session = this.mongoClient.startSession();
    let admission: AdmissionResult | undefined;

    try {
      const attemptsExpression = { $ifNull: ['$attempts', []] };
      const alreadyPresentExpression = {
        $in: [
          { $literal: persistedAttempt.attemptId },
          {
            $map: {
              input: attemptsExpression,
              as: 'storedAttempt',
              in: '$$storedAttempt.attemptId'
            }
          }
        ]
      };
      const canAdmitExpression = {
        $and: [
          { $lt: [{ $size: attemptsExpression }, maxAttempts] },
          { $not: [alreadyPresentExpression] }
        ]
      };
      const hasPendingJobExpression = {
        $gt: [
          {
            $size: {
              $filter: {
                input: attemptsExpression,
                as: 'storedAttempt',
                cond: { $in: ['$$storedAttempt.job.state', ['queued', 'leased']] }
              }
            }
          },
          0
        ]
      };

      await session.withTransaction(async () => {
        const reserved = await this.reservePendingCapacity(session, attempt.receivedAt);
        if (!reserved) {
          throw new AdmissionTransactionRejected({ success: false, reason: 'capacity_exceeded' });
        }

        const updated = await this.collection.findOneAndUpdate(
          { userId: userObjectId, localDate, 'attempts.attemptId': { $ne: attempt.attemptId } },
          [
            {
              $set: {
                schemaVersion: { $literal: 1 },
                userId: { $literal: userObjectId },
                localDate: { $literal: localDate },
                historyPurgeAt: {
                  $max: [
                    { $ifNull: ['$historyPurgeAt', '$purgeAt'] },
                    { $literal: purgeAt }
                  ]
                },
                purgeAt: {
                  $cond: [
                    canAdmitExpression,
                    NO_PURGE_DATE,
                    { $cond: [hasPendingJobExpression, NO_PURGE_DATE, { $ifNull: ['$purgeAt', '$historyPurgeAt'] }] }
                  ]
                },
                attempts: {
                  $cond: [
                    canAdmitExpression,
                    { $concatArrays: [attemptsExpression, [{ $literal: persistedAttempt }]] },
                    attemptsExpression
                  ]
                }
              }
            }
          ],
          { upsert: true, returnDocument: 'after', session }
        );

        if (!updated || !updated.attempts.some((storedAttempt) => storedAttempt.attemptId === attempt.attemptId)) {
          throw new AdmissionTransactionRejected({ success: false, reason: 'quota_exceeded' });
        }
        admission = { success: true, attempt };
      }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary'
      });

      if (!admission) throw new AnalysisQueueUnavailableError();
      return admission;
    } catch (error: unknown) {
      if (error instanceof AdmissionTransactionRejected) return error.result;
      if (error instanceof MongoServerError && error.code === 11000) {
        const existingDaily = await this.collection.findOne({ userId: userObjectId, localDate });
        if (existingDaily) {
          if (existingDaily.attempts.some((a) => a.attemptId === attempt.attemptId)) {
            return { success: false, reason: 'duplicate_attempt_id' };
          }
        }
        const existingAttempt = await this.collection.findOne({ 'attempts.attemptId': attempt.attemptId });
        if (existingAttempt) {
          return { success: false, reason: 'duplicate_attempt_id' };
        }
        if (existingDaily && existingDaily.attempts.length >= maxAttempts) {
          return { success: false, reason: 'quota_exceeded' };
        }
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  public async updateAttempt(
    userId: string,
    localDate: string,
    attemptId: string,
    updates: Partial<AttemptProps>
  ): Promise<boolean> {
    if (!ObjectId.isValid(userId)) {
      return false;
    }

    let expectedCurrentStatus: AttemptProps['processingStatus'] | undefined;
    if (updates.processingStatus !== undefined) {
      switch (updates.processingStatus) {
        case 'processing':
        case 'validation_failed':
          expectedCurrentStatus = 'received';
          break;
        case 'completed':
        case 'inconclusive':
        case 'failed':
          // Terminal transitions must release the global queue slot atomically.
          return false;
        case 'received':
          // Admission creates the received state; workers must never reopen it.
          return false;
      }
    }

    const setFields: Record<string, unknown> = {
      'attempts.$.updatedAt': new Date()
    };

    if (updates.processingStatus) {
      setFields['attempts.$.processingStatus'] = updates.processingStatus;
    }
    if (updates.completedAt) {
      setFields['attempts.$.completedAt'] = updates.completedAt;
    }
    if (updates.analysis) {
      setFields['attempts.$.analysis'] = omitUndefinedDeep(updates.analysis);
    }

    const result = await this.collection.updateOne(
      {
        userId: new ObjectId(userId),
        localDate,
        attempts: {
          $elemMatch: {
            attemptId,
            ...(expectedCurrentStatus ? { processingStatus: expectedCurrentStatus } : {})
          }
        }
      },
      { $set: setFields }
    );

    return result.modifiedCount > 0;
  }

  public async claimNextAnalysisJob(
    workerId: string,
    now: Date,
    leaseDurationMs: number,
    maxAttempts = 10
  ): Promise<ClaimedAnalysisJob | null> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(workerId) || !Number.isInteger(leaseDurationMs) || leaseDurationMs < 1_000 ||
        !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      throw new Error('Analysis job worker identity or lease duration is invalid.');
    }

    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
    const eligibleAttemptFilter = {
      processingStatus: { $in: ['received', 'processing'] },
      'job.availableAt': { $lte: now },
      $and: [{ $or: [{ submittedInput: { $type: 'string' } }, { submittedInputEncrypted: { $exists: true } }] }],
      $or: [
        { 'job.state': 'queued' },
        { 'job.state': 'leased', 'job.leaseExpiresAt': { $lte: now } }
      ]
    };
    const eligibleAttempts = {
      $filter: {
        input: '$attempts',
        as: 'candidate',
        cond: {
          $and: [
            { $in: ['$$candidate.processingStatus', ['received', 'processing']] },
            { $lte: ['$$candidate.job.availableAt', { $literal: now }] },
            {
              $or: [
                { $ne: [{ $type: '$$candidate.submittedInput' }, 'missing'] },
                { $ne: [{ $type: '$$candidate.submittedInputEncrypted' }, 'missing'] }
              ]
            },
            {
              $or: [
                { $eq: ['$$candidate.job.state', 'queued'] },
                {
                  $and: [
                    { $eq: ['$$candidate.job.state', 'leased'] },
                    { $lte: ['$$candidate.job.leaseExpiresAt', { $literal: now }] }
                  ]
                }
              ]
            }
          ]
        }
      }
    };
    const session = this.mongoClient.startSession();
    let updated: DailyAnalysisDoc | null = null;
    try {
    await session.withTransaction(async () => {
    updated = await this.collection.findOneAndUpdate(
      {
        attempts: { $elemMatch: eligibleAttemptFilter }
      },
      [
        {
          $set: {
            attempts: {
              $let: {
                vars: { selected: { $arrayElemAt: [eligibleAttempts, 0] } },
                in: {
                  $map: {
                    input: '$attempts',
                    as: 'candidate',
                    in: {
                      $cond: [
                        { $eq: ['$$candidate.attemptId', '$$selected.attemptId'] },
                        {
                          $cond: [
                            { $gte: ['$$candidate.job.attemptCount', { $literal: maxAttempts }] },
                            {
                              $mergeObjects: [
                                '$$candidate',
                                {
                                  processingStatus: 'failed',
                                  updatedAt: { $literal: now },
                                  completedAt: { $literal: now },
                                  job: withoutJobLeaseMetadata({
                                    $mergeObjects: ['$$candidate.job', { state: 'dead', lastFailureCode: 'worker_lease_exhausted' }]
                                  })
                                }
                              ]
                            },
                            {
                              $mergeObjects: [
                                '$$candidate',
                                {
                                  processingStatus: 'processing',
                                  updatedAt: { $literal: now },
                                  job: {
                                    $mergeObjects: [
                                      '$$candidate.job',
                                      {
                                        state: 'leased',
                                        attemptCount: { $add: ['$$candidate.job.attemptCount', 1] },
                                        leaseOwner: { $literal: workerId },
                                        leaseToken: { $literal: leaseToken },
                                        leaseExpiresAt: { $literal: leaseExpiresAt }
                                      }
                                    ]
                                  }
                                }
                              ]
                            }
                          ]
                        },
                        '$$candidate'
                      ]
                    }
                  }
                }
              }
            }
          }
        }
      ],
      { returnDocument: 'after', sort: { 'attempts.job.availableAt': 1, localDate: 1 }, session }
    );
    if (updated) {
      const exhausted = updated.attempts.some((candidate) => candidate.job?.state === 'dead' && candidate.job.lastFailureCode === 'worker_lease_exhausted' && candidate.updatedAt.getTime() === now.getTime());
      if (exhausted) await this.releasePendingCapacity(session, updated, now);
    }
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    } finally { await session.endSession(); }

    const claimedDoc = updated as DailyAnalysisDoc | null;
    if (!claimedDoc) return null;
    const attempt = claimedDoc.attempts.find((candidate) => candidate.job?.leaseToken === leaseToken);
    const exhaustedAttempt = attempt ? undefined : claimedDoc.attempts.find((candidate) =>
      candidate.job?.state === 'dead' && candidate.job.lastFailureCode === 'worker_lease_exhausted' &&
      candidate.updatedAt.getTime() === now.getTime()
    );
    const selected = attempt ?? exhaustedAttempt;
    if (!selected?.job || !claimedDoc.userId) return null;
    const hydrated = this.decodeAttempt(claimedDoc.userId.toHexString(), claimedDoc.localDate, selected);
    if (!hydrated.submittedInput) return null;
    return {
      userId: claimedDoc.userId.toHexString(),
      localDate: claimedDoc.localDate,
      attemptId: selected.attemptId,
      leaseToken,
      attemptNumber: selected.job.attemptCount,
      targetUrl: hydrated.submittedInput,
      ...(exhaustedAttempt ? { leaseExhausted: true } : {})
    };
  }

  public async completeClaimedAnalysisJob(
    job: ClaimedAnalysisJob,
    completedAt: Date,
    analysis: AttemptProps['analysis']
  ): Promise<boolean> {
    if (!ObjectId.isValid(job.userId) || !analysis) return false;
    const session = this.mongoClient.startSession();
    let modified = false;
    try {
      await session.withTransaction(async () => {
    const result = await this.collection.updateOne(
      {
        userId: new ObjectId(job.userId),
        localDate: job.localDate,
        attempts: { $elemMatch: { attemptId: job.attemptId, processingStatus: 'processing', 'job.leaseToken': job.leaseToken } }
      },
      [
        {
          $set: {
            attempts: {
              $map: {
                input: '$attempts',
                as: 'attempt',
                in: {
                  $cond: [
                    { $eq: ['$$attempt.attemptId', { $literal: job.attemptId }] },
                    {
                      $mergeObjects: [
                        '$$attempt',
                        {
                          processingStatus: 'completed',
                          updatedAt: { $literal: completedAt },
                          completedAt: { $literal: completedAt },
                          analysis: { $literal: omitUndefinedDeep(analysis) },
                          job: withoutJobLeaseMetadata({ $mergeObjects: ['$$attempt.job', { state: 'completed' }] })
                        }
                      ]
                    },
                    '$$attempt'
                  ]
                }
              }
            }
          }
        }
      ], { session }
    );
    modified = result.modifiedCount > 0;
    if (modified) {
      const doc = await this.collection.findOne({ userId: new ObjectId(job.userId), localDate: job.localDate }, { session });
      if (!doc) throw new AnalysisQueueUnavailableError();
      await this.releasePendingCapacity(session, doc, completedAt);
    }
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
      return modified;
    } finally { await session.endSession(); }
  }

  public async retryClaimedAnalysisJob(
    job: ClaimedAnalysisJob,
    now: Date,
    nextAttemptAt: Date,
    reasonCode: string,
    maxAttempts: number
  ): Promise<RetryClaimResult> {
    if (!ObjectId.isValid(job.userId) || !/^[a-z0-9_]{1,64}$/.test(reasonCode) || !Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error('Analysis job retry parameters are invalid.');
    }
    const claimFilter = {
      userId: new ObjectId(job.userId),
      localDate: job.localDate,
      attempts: { $elemMatch: { attemptId: job.attemptId, processingStatus: 'processing', 'job.leaseToken': job.leaseToken } }
    };

    if (job.attemptNumber >= maxAttempts) {
      const terminal = await this.failClaimedAnalysisJob(job, now, 'failed', reasonCode);
      return terminal ? 'exhausted' : 'stale';
    }

    const result = await this.collection.updateOne(claimFilter, [
      {
        $set: {
          attempts: {
            $map: {
              input: '$attempts',
              as: 'attempt',
              in: {
                $cond: [
                  { $eq: ['$$attempt.attemptId', { $literal: job.attemptId }] },
                  {
                    $mergeObjects: [
                      '$$attempt',
                      {
                        updatedAt: { $literal: now },
                        job: withoutJobLeaseMetadata({
                          $mergeObjects: [
                            '$$attempt.job',
                            {
                              state: 'queued',
                              availableAt: { $literal: nextAttemptAt },
                              lastFailureCode: { $literal: reasonCode }
                            }
                          ]
                        })
                      }
                    ]
                  },
                  '$$attempt'
                ]
              }
            }
          }
        }
      }
    ]);
    return result.modifiedCount > 0 ? 'rescheduled' : 'stale';
  }

  public async failClaimedAnalysisJob(
    job: ClaimedAnalysisJob,
    completedAt: Date,
    status: 'failed' | 'inconclusive',
    reasonCode: string
  ): Promise<boolean> {
    if (!ObjectId.isValid(job.userId) || !/^[a-z0-9_]{1,64}$/.test(reasonCode)) return false;
    const session = this.mongoClient.startSession();
    let modified = false;
    try {
    await session.withTransaction(async () => {
    const result = await this.collection.updateOne(
      {
        userId: new ObjectId(job.userId),
        localDate: job.localDate,
        attempts: { $elemMatch: { attemptId: job.attemptId, processingStatus: 'processing', 'job.leaseToken': job.leaseToken } }
      },
      [
        {
          $set: {
            attempts: {
              $map: {
                input: '$attempts',
                as: 'attempt',
                in: {
                  $cond: [
                    { $eq: ['$$attempt.attemptId', { $literal: job.attemptId }] },
                    {
                      $mergeObjects: [
                        '$$attempt',
                        {
                          processingStatus: { $literal: status },
                          updatedAt: { $literal: completedAt },
                          completedAt: { $literal: completedAt },
                          job: withoutJobLeaseMetadata({
                            $mergeObjects: [
                              '$$attempt.job',
                              {
                                state: 'dead',
                                lastFailureCode: { $literal: reasonCode }
                              }
                            ]
                          })
                        }
                      ]
                    },
                    '$$attempt'
                  ]
                }
              }
            }
          }
        }
      ], { session }
    );
    modified = result.modifiedCount > 0;
    if (modified) {
      const doc = await this.collection.findOne({ userId: new ObjectId(job.userId), localDate: job.localDate }, { session });
      if (!doc) throw new AnalysisQueueUnavailableError();
      await this.releasePendingCapacity(session, doc, completedAt);
    }
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    return modified;
    } finally { await session.endSession(); }
  }

  public async getAnalysisQueueSnapshot(now: Date): Promise<AnalysisQueueSnapshot> {
    if (Number.isNaN(now.getTime())) throw new Error('Analysis queue snapshot time must be valid.');
    const [capacity, rollup] = await Promise.all([
      this.capacityCollection.findOne({ _id: 'global' }, { projection: { pendingCount: 1, maxPending: 1 } }),
      this.collection.aggregate<{
        active?: Array<{
          queuedCount: number;
          leasedCount: number;
          expiredLeaseCount: number;
          retryingCount: number;
          oldestPendingAt?: Date;
        }>;
        dead?: Array<{ deadCount: number }>;
      }>([
        { $match: { 'attempts.job.state': { $in: ['queued', 'leased', 'dead'] } } },
        { $unwind: '$attempts' },
        { $match: { 'attempts.job.state': { $in: ['queued', 'leased', 'dead'] } } },
        {
          $facet: {
            active: [
              { $match: { 'attempts.job.state': { $in: ['queued', 'leased'] } } },
              {
                $group: {
                  _id: null,
                  queuedCount: { $sum: { $cond: [{ $eq: ['$attempts.job.state', 'queued'] }, 1, 0] } },
                  leasedCount: { $sum: { $cond: [{ $eq: ['$attempts.job.state', 'leased'] }, 1, 0] } },
                  expiredLeaseCount: {
                    $sum: {
                      $cond: [
                        { $and: [{ $eq: ['$attempts.job.state', 'leased'] }, { $lte: ['$attempts.job.leaseExpiresAt', now] }] },
                        1,
                        0
                      ]
                    }
                  },
                  retryingCount: {
                    $sum: { $cond: [{ $gt: ['$attempts.job.attemptCount', 1] }, 1, 0] }
                  },
                  oldestPendingAt: { $min: '$attempts.receivedAt' }
                }
              }
            ],
            dead: [
              { $match: { 'attempts.job.state': 'dead' } },
              { $count: 'deadCount' }
            ]
          }
        }
      ]).toArray().then((rows) => rows[0])
    ]);

    if (!capacity || !Number.isSafeInteger(capacity.pendingCount) || !Number.isSafeInteger(capacity.maxPending)) {
      throw new Error('Analysis queue capacity is unavailable.');
    }
    const active = rollup?.active?.[0];
    const dead = rollup?.dead?.[0];
    const oldestPendingAt = active?.oldestPendingAt;
    return {
      pendingCount: capacity.pendingCount,
      maxPending: capacity.maxPending,
      queuedCount: active?.queuedCount ?? 0,
      leasedCount: active?.leasedCount ?? 0,
      expiredLeaseCount: active?.expiredLeaseCount ?? 0,
      retryingCount: active?.retryingCount ?? 0,
      deadCount: dead?.deadCount ?? 0,
      oldestPendingAgeMs: oldestPendingAt ? Math.max(0, now.getTime() - oldestPendingAt.getTime()) : null
    };
  }

  public async findDailyAnalysis(userId: string, localDate: string): Promise<DailyAnalysis | null> {
    if (!ObjectId.isValid(userId)) {
      return null;
    }
    const doc = await this.collection.findOne({
      userId: new ObjectId(userId),
      localDate,
      historyPurgeAt: { $gt: new Date() }
    });
    return doc ? this.toEntity(doc) : null;
  }

  public async findAttemptByLocalKey(
    userId: string,
    localDate: string,
    attemptId: string
  ): Promise<{ dailyAnalysis: DailyAnalysis; attempt: AttemptProps } | null> {
    if (!ObjectId.isValid(userId)) {
      return null;
    }
    const doc = await this.collection.findOne({
      userId: new ObjectId(userId),
      localDate,
      'attempts.attemptId': attemptId,
      historyPurgeAt: { $gt: new Date() }
    });

    if (!doc) {
      return null;
    }

    const dailyAnalysis = this.toEntity(doc);
    const attempt = dailyAnalysis.findAttempt(attemptId);
    if (!attempt) {
      return null;
    }

    return {
      dailyAnalysis,
      attempt
    };
  }

  public async findAttemptGlobally(
    attemptId: string
  ): Promise<{ dailyAnalysis: DailyAnalysis; attempt: AttemptProps } | null> {
    const doc = await this.collection.findOne({
      'attempts.attemptId': attemptId,
      historyPurgeAt: { $gt: new Date() }
    });

    if (!doc) {
      return null;
    }

    const dailyAnalysis = this.toEntity(doc);
    const attempt = dailyAnalysis.findAttempt(attemptId);
    if (!attempt) {
      return null;
    }

    return {
      dailyAnalysis,
      attempt
    };
  }

  public async listUserAttempts(
    userId: string,
    options: ListUserAttemptsOptions
  ): Promise<PaginatedAttemptsResult> {
    if (!ObjectId.isValid(userId)) {
      return { items: [], hasMore: false, nextCursor: null };
    }

    const matchStage: Record<string, unknown> = {
      userId: new ObjectId(userId),
      historyPurgeAt: { $gt: new Date() }
    };

    if (options.startDate && options.endDate) {
      matchStage['localDate'] = { $gte: options.startDate, $lte: options.endDate };
    } else if (options.startDate) {
      matchStage['localDate'] = { $gte: options.startDate };
    } else if (options.endDate) {
      matchStage['localDate'] = { $lte: options.endDate };
    }

    const pipeline: Array<Record<string, unknown>> = [
      { $match: matchStage },
      { $unwind: '$attempts' },
      {
        $project: {
          localDate: 1,
          attemptId: '$attempts.attemptId',
          receivedAt: '$attempts.receivedAt',
          updatedAt: '$attempts.updatedAt',
          completedAt: '$attempts.completedAt',
          processingStatus: '$attempts.processingStatus',
          submittedInput: '$attempts.submittedInput',
          submittedInputEncrypted: '$attempts.submittedInputEncrypted',
          inputDigest: '$attempts.inputDigest',
          inputSizeBytes: '$attempts.inputSizeBytes',
          analysis: '$attempts.analysis'
        }
      },
      {
        $sort: {
          localDate: -1,
          receivedAt: -1,
          attemptId: -1
        }
      }
    ];

    if (options.cursor !== undefined) {
      const decoded = decodeHistoryCursor(options.cursor);
      pipeline.push({
        $match: {
          $or: [
            { localDate: { $lt: decoded.localDate } },
            {
              localDate: decoded.localDate,
              receivedAt: { $lt: decoded.receivedAt }
            },
            {
              localDate: decoded.localDate,
              receivedAt: decoded.receivedAt,
              attemptId: { $lt: decoded.attemptId }
            }
          ]
        }
      });
    }

    pipeline.push({ $limit: options.limit + 1 });

    const rawRows = await this.collection.aggregate(pipeline).toArray();
    const hasMore = rawRows.length > options.limit;
    const items = rawRows.slice(0, options.limit).map((row) => {
      const localDate = row['localDate'] as string;
      const attempt = this.decodeAttempt(userId, localDate, {
        attemptId: row['attemptId'] as string,
        receivedAt: row['receivedAt'] as Date,
        updatedAt: row['updatedAt'] as Date,
        completedAt: row['completedAt'] as Date | undefined,
        processingStatus: row['processingStatus'] as AttemptProps['processingStatus'],
        submittedInput: row['submittedInput'] as string | undefined,
        submittedInputEncrypted: row['submittedInputEncrypted'] as EncryptedAnalysisInput | undefined,
        inputDigest: row['inputDigest'] as string,
        inputSizeBytes: row['inputSizeBytes'] as number,
        analysis: row['analysis'] as AttemptProps['analysis']
      });
      return { ...attempt, localDate };
    });

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({
          localDate: lastItem.localDate,
          receivedAt: lastItem.receivedAt.toISOString(),
          attemptId: lastItem.attemptId
        })
      ).toString('base64url');
    }

    return {
      items,
      hasMore,
      nextCursor
    };
  }

  public async getMetrics(startDate: string, endDate: string): Promise<AdminMetricsResult> {
    const pipeline = [
      {
        $match: {
          localDate: { $gte: startDate, $lte: endDate },
          historyPurgeAt: { $gt: new Date() }
        }
      },
      { $unwind: '$attempts' },
      {
        $group: {
          _id: null,
          totalAttempts: { $sum: 1 },
          received: { $sum: { $cond: [{ $eq: ['$attempts.processingStatus', 'received'] }, 1, 0] } },
          validation_failed: {
            $sum: { $cond: [{ $eq: ['$attempts.processingStatus', 'validation_failed'] }, 1, 0] }
          },
          processing: { $sum: { $cond: [{ $eq: ['$attempts.processingStatus', 'processing'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$attempts.processingStatus', 'completed'] }, 1, 0] } },
          inconclusive: { $sum: { $cond: [{ $eq: ['$attempts.processingStatus', 'inconclusive'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$attempts.processingStatus', 'failed'] }, 1, 0] } },
          peligroso: { $sum: { $cond: [{ $eq: ['$attempts.analysis.verdict', 'peligroso'] }, 1, 0] } },
          sospechoso: { $sum: { $cond: [{ $eq: ['$attempts.analysis.verdict', 'sospechoso'] }, 1, 0] } },
          sin_amenazas_detectadas: {
            $sum: { $cond: [{ $eq: ['$attempts.analysis.verdict', 'sin_amenazas_detectadas'] }, 1, 0] }
          }
        }
      }
    ];

    const results = await this.collection.aggregate(pipeline).toArray();
    const metrics = results[0] as Record<string, number> | undefined;

    return {
      dateRange: { startDate, endDate },
      totalAttempts: metrics?.['totalAttempts'] ?? 0,
      byStatus: {
        received: metrics?.['received'] ?? 0,
        validation_failed: metrics?.['validation_failed'] ?? 0,
        processing: metrics?.['processing'] ?? 0,
        completed: metrics?.['completed'] ?? 0,
        inconclusive: metrics?.['inconclusive'] ?? 0,
        failed: metrics?.['failed'] ?? 0
      },
      byVerdict: {
        peligroso: metrics?.['peligroso'] ?? 0,
        sospechoso: metrics?.['sospechoso'] ?? 0,
        sin_amenazas_detectadas: metrics?.['sin_amenazas_detectadas'] ?? 0
      }
    };
  }

  public async getUserAnalysisSummary(
    userId: string,
    startsAtInclusive: Date,
    endsAtExclusive: Date
  ): Promise<UserAnalysisSummaryCounts> {
    if (!ObjectId.isValid(userId) || startsAtInclusive >= endsAtExclusive) {
      return { total: 0, dangerous: 0, suspicious: 0 };
    }

    const firstLocalDate = getLocalDate(startsAtInclusive);
    const lastLocalDate = getLocalDate(new Date(endsAtExclusive.getTime() - 1));
    const results = await this.collection.aggregate([
      {
        $match: {
          userId: new ObjectId(userId),
          localDate: { $gte: firstLocalDate, $lte: lastLocalDate },
          historyPurgeAt: { $gt: new Date() }
        }
      },
      { $unwind: '$attempts' },
      {
        $match: {
          'attempts.receivedAt': { $gte: startsAtInclusive, $lt: endsAtExclusive }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          dangerous: { $sum: { $cond: [{ $eq: ['$attempts.analysis.verdict', 'peligroso'] }, 1, 0] } },
          suspicious: { $sum: { $cond: [{ $eq: ['$attempts.analysis.verdict', 'sospechoso'] }, 1, 0] } }
        }
      }
    ]).toArray();
    const counts = results[0] as Record<string, number> | undefined;

    return {
      total: counts?.['total'] ?? 0,
      dangerous: counts?.['dangerous'] ?? 0,
      suspicious: counts?.['suspicious'] ?? 0
    };
  }

  private async reservePendingCapacity(session: ClientSession, updatedAt: Date): Promise<boolean> {
    const result = await this.capacityCollection.findOneAndUpdate(
      { _id: 'global', maxPending: this.maxPending, $expr: { $lt: ['$pendingCount', '$maxPending'] } },
      { $inc: { pendingCount: 1 }, $set: { updatedAt } },
      { session, returnDocument: 'after' }
    );
    if (result) return true;
    const capacity = await this.capacityCollection.findOne({ _id: 'global' }, { session });
    if (!capacity || capacity.maxPending !== this.maxPending || !Number.isSafeInteger(capacity.pendingCount)) {
      throw new AnalysisQueueUnavailableError();
    }
    return false;
  }

  private async releasePendingCapacity(session: ClientSession, doc: DailyAnalysisDoc, updatedAt: Date): Promise<void> {
    const capacity = await this.capacityCollection.findOneAndUpdate(
      { _id: 'global', maxPending: this.maxPending, pendingCount: { $gt: 0 } },
      { $inc: { pendingCount: -1 }, $set: { updatedAt } },
      { session, returnDocument: 'after' }
    );
    if (!capacity) throw new AnalysisQueueUnavailableError();

    const stillPending = doc.attempts.some((attempt) => attempt.job?.state === 'queued' || attempt.job?.state === 'leased');
    await this.collection.updateOne(
      { _id: doc._id },
      stillPending ? { $unset: { purgeAt: '' } } : { $set: { purgeAt: doc.historyPurgeAt } },
      { session }
    );
  }

  private encodeAttempt(userId: string, localDate: string, attempt: AttemptProps): PersistedAttemptProps {
    const { submittedInput, ...metadata } = attempt;
    if (submittedInput === undefined) {
      return omitUndefinedDeep({
        ...metadata,
        job: { state: 'queued', attemptCount: 0, availableAt: attempt.receivedAt }
      }) as PersistedAttemptProps;
    }
    return omitUndefinedDeep({
      ...metadata,
      submittedInputEncrypted: this.inputCipher.encrypt(submittedInput, {
        attemptId: attempt.attemptId,
        userId,
        localDate
      }),
      job: { state: 'queued', attemptCount: 0, availableAt: attempt.receivedAt }
    }) as PersistedAttemptProps;
  }

  private decodeAttempt(userId: string, localDate: string, attempt: PersistedAttemptProps): AttemptProps {
    const { job: _job, ...publicAttempt } = attempt;
    if (!attempt.submittedInputEncrypted) {
      return publicAttempt;
    }
    if (attempt.submittedInput !== undefined) {
      throw new Error('Persisted analysis input has conflicting plaintext and encrypted values.');
    }
    const { submittedInputEncrypted: _encrypted, ...metadata } = publicAttempt;
    return {
      ...metadata,
      submittedInput: this.inputCipher.decrypt(attempt.submittedInputEncrypted, {
        attemptId: attempt.attemptId,
        userId,
        localDate
      })
    };
  }

  private toEntity(doc: DailyAnalysisDoc): DailyAnalysis {
    return new DailyAnalysis({
      id: doc._id.toHexString(),
      userId: doc.userId.toHexString(),
      localDate: doc.localDate,
      attempts: doc.attempts.map((attempt) => this.decodeAttempt(doc.userId.toHexString(), doc.localDate, attempt)),
      purgeAt: doc.historyPurgeAt
    });
  }
}
