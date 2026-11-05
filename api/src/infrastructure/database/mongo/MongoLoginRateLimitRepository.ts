import { Collection, Db } from 'mongodb';
import { ILoginRateLimitRepository } from '../../../core/ports/ILoginRateLimitRepository.js';

interface LoginRateLimitDocument {
  _id: string;
  schemaVersion: number;
  events: Date[];
  expiresAt: Date;
}

const COLLECTION_NAME = 'login_rate_limit_buckets';
const TTL_INDEX_NAME = 'ttl_login_rate_limit_expires_at';

export class MongoLoginRateLimitRepository implements ILoginRateLimitRepository {
  private readonly collection: Collection<LoginRateLimitDocument>;

  constructor(private readonly db: Db) {
    this.collection = db.collection<LoginRateLimitDocument>(COLLECTION_NAME);
  }

  public async assertReady(): Promise<void> {
    const info = await this.db.listCollections({ name: COLLECTION_NAME }, { nameOnly: false }).next();
    if (!info) throw new Error(`Required MongoDB collection '${COLLECTION_NAME}' is missing; apply migration 002 first.`);

    const validator = info.options?.validator as { $jsonSchema?: { additionalProperties?: boolean; properties?: Record<string, { pattern?: string; maxItems?: number; items?: { bsonType?: string } }> } } | undefined;
    const jsonSchema = validator?.$jsonSchema;
    const properties = jsonSchema?.properties;
    const compatible = jsonSchema?.additionalProperties === false && properties &&
      ['_id', 'schemaVersion', 'events', 'expiresAt'].every((field) => field in properties) &&
      properties._id?.pattern === '^v1:[a-f0-9]{64}$' &&
      properties.events?.maxItems === 20 && properties.events.items?.bsonType === 'date';
    if (!compatible || info.options?.validationLevel !== 'strict' || info.options?.validationAction !== 'error') {
      throw new Error(`MongoDB collection '${COLLECTION_NAME}' does not have the expected strict validator.`);
    }

    const indexes = await this.collection.listIndexes().toArray();
    if (!indexes.some((index) => index.name === TTL_INDEX_NAME && index.expireAfterSeconds === 0)) {
      throw new Error(`MongoDB collection '${COLLECTION_NAME}' is missing its TTL index.`);
    }
  }

  public async getRecentEvents(bucketId: string, since: Date): Promise<Date[]> {
    const document = await this.collection.findOne({ _id: bucketId }, { projection: { events: 1 } });
    return (document?.events ?? []).filter((event) => event > since);
  }

  public async tryRecordEvent(
    bucketId: string,
    occurredAt: Date,
    since: Date,
    expiresAt: Date,
    maxEvents: number
  ): Promise<boolean> {
    const activeEvents = {
      $filter: {
        input: { $ifNull: ['$events', []] },
        as: 'event',
        cond: { $gt: ['$$event', since] }
      }
    };

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const updated = await this.collection.findOneAndUpdate(
        {
          _id: bucketId,
          $expr: { $lt: [{ $size: activeEvents }, maxEvents] }
        },
        [
          {
            $set: {
              schemaVersion: { $literal: 1 },
              events: { $concatArrays: [activeEvents, [{ $literal: occurredAt }]] },
              expiresAt: { $literal: expiresAt }
            }
          }
        ],
        { returnDocument: 'after' }
      );
      if (updated) return true;

      const current = await this.collection.findOne({ _id: bucketId }, { projection: { events: 1 } });
      const currentEvents = (current?.events ?? []).filter((event) => event > since);
      if (currentEvents.length >= maxEvents) return false;

      if (!current) {
        try {
          await this.collection.insertOne({
            _id: bucketId,
            schemaVersion: 1,
            events: [occurredAt],
            expiresAt
          });
          return true;
        } catch (error) {
          if ((error as { code?: number }).code !== 11000) throw error;
        }
      }
    }

    throw new Error('Could not atomically update the login rate-limit bucket after repeated contention.');
  }

  public async deleteBucket(bucketId: string): Promise<void> {
    await this.collection.deleteOne({ _id: bucketId });
  }
}
