import { Db, ObjectId, MongoServerError } from 'mongodb';
import {
  IDailyAnalysisRepository,
  AdmissionResult,
  ListUserAttemptsOptions,
  PaginatedAttemptsResult,
  AdminMetricsResult
} from '../../../core/ports/IDailyAnalysisRepository.js';
import { DailyAnalysis, AttemptProps } from '../../../core/entities/Analysis.js';

interface DailyAnalysisDoc {
  _id: ObjectId;
  schemaVersion: number;
  userId: ObjectId;
  localDate: string;
  attempts: AttemptProps[];
  purgeAt: Date;
}

export class MongoDailyAnalysisRepository implements IDailyAnalysisRepository {
  constructor(private readonly db: Db) {}

  private get collection() {
    return this.db.collection<DailyAnalysisDoc>('daily_analyses');
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
    const purgeAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    try {
      const result = await this.collection.findOneAndUpdate(
        {
          userId: userObjectId,
          localDate,
          $expr: { $lt: [{ $size: { $ifNull: ['$attempts', []] } }, maxAttempts] },
          'attempts.attemptId': { $ne: attempt.attemptId }
        },
        {
          $setOnInsert: {
            schemaVersion: 1,
            userId: userObjectId,
            localDate,
            purgeAt
          },
          $push: { attempts: attempt }
        },
        { upsert: true, returnDocument: 'after' }
      );

      if (result) {
        return { success: true, attempt };
      }

      return { success: false, reason: 'quota_exceeded' };
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === 11000) {
        // Unique index collision: Either duplicate attemptId or daily quota is already 5
        const existingDaily = await this.collection.findOne({ userId: userObjectId, localDate });
        if (existingDaily) {
          if (existingDaily.attempts.some((a) => a.attemptId === attempt.attemptId)) {
            return { success: false, reason: 'duplicate_attempt_id' };
          }
          if (existingDaily.attempts.length >= maxAttempts) {
            return { success: false, reason: 'quota_exceeded' };
          }
        }
      }
      throw error;
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
      setFields['attempts.$.analysis'] = updates.analysis;
    }

    const result = await this.collection.updateOne(
      {
        userId: new ObjectId(userId),
        localDate,
        'attempts.attemptId': attemptId
      },
      { $set: setFields }
    );

    return result.modifiedCount > 0;
  }

  public async findDailyAnalysis(userId: string, localDate: string): Promise<DailyAnalysis | null> {
    if (!ObjectId.isValid(userId)) {
      return null;
    }
    const doc = await this.collection.findOne({
      userId: new ObjectId(userId),
      localDate
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
      'attempts.attemptId': attemptId
    });

    if (!doc) {
      return null;
    }

    const attempt = doc.attempts.find((a) => a.attemptId === attemptId);
    if (!attempt) {
      return null;
    }

    return {
      dailyAnalysis: this.toEntity(doc),
      attempt
    };
  }

  public async findAttemptGlobally(
    attemptId: string
  ): Promise<{ dailyAnalysis: DailyAnalysis; attempt: AttemptProps } | null> {
    const doc = await this.collection.findOne({
      'attempts.attemptId': attemptId
    });

    if (!doc) {
      return null;
    }

    const attempt = doc.attempts.find((a) => a.attemptId === attemptId);
    if (!attempt) {
      return null;
    }

    return {
      dailyAnalysis: this.toEntity(doc),
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
      purgeAt: { $gt: new Date() }
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

    if (options.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')) as {
          localDate: string;
          receivedAt: string;
          attemptId: string;
        };

        pipeline.push({
          $match: {
            $or: [
              { localDate: { $lt: decoded.localDate } },
              {
                localDate: decoded.localDate,
                receivedAt: { $lt: new Date(decoded.receivedAt) }
              },
              {
                localDate: decoded.localDate,
                receivedAt: new Date(decoded.receivedAt),
                attemptId: { $lt: decoded.attemptId }
              }
            ]
          }
        });
      } catch {
        // Invalid cursor format: ignore and return first page
      }
    }

    pipeline.push({ $limit: options.limit + 1 });

    const rawRows = await this.collection.aggregate(pipeline).toArray();
    const hasMore = rawRows.length > options.limit;
    const items = rawRows.slice(0, options.limit).map((row) => ({
      attemptId: row['attemptId'] as string,
      localDate: row['localDate'] as string,
      receivedAt: row['receivedAt'] as Date,
      updatedAt: row['updatedAt'] as Date,
      completedAt: row['completedAt'] as Date | undefined,
      processingStatus: row['processingStatus'] as AttemptProps['processingStatus'],
      submittedInput: row['submittedInput'] as string | undefined,
      inputDigest: row['inputDigest'] as string,
      inputSizeBytes: row['inputSizeBytes'] as number,
      analysis: row['analysis'] as AttemptProps['analysis']
    }));

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
          localDate: { $gte: startDate, $lte: endDate }
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

  private toEntity(doc: DailyAnalysisDoc): DailyAnalysis {
    return new DailyAnalysis({
      id: doc._id.toHexString(),
      userId: doc.userId.toHexString(),
      localDate: doc.localDate,
      attempts: doc.attempts,
      purgeAt: doc.purgeAt
    });
  }
}
