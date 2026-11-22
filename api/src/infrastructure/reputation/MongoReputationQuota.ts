import { createHmac } from 'node:crypto';
import { type Db, type Document } from 'mongodb';
import type { IReputationQuota } from '../../core/ports/IReputationProvider.js';

/** All callers using one key must use the same MongoDB database. */
export class MongoReputationQuota implements IReputationQuota {
  private readonly collection;
  private readonly id: string;

  constructor(db: Db, apiKey: string) {
    this.collection = db.collection<Document & { _id: string }>('reputation_quota');
    this.id = createHmac('sha256', apiKey).update('enlaceseguro-virustotal-quota-v1').digest('hex');
  }

  async reserve(): Promise<boolean> {
    // Initialize independently so the subsequent filtered update never upserts past a full quota.
    try {
      await this.collection.updateOne({ _id: this.id }, { $setOnInsert: { requests: [], cooldownUntil: new Date(0) } }, { upsert: true });
    } catch { throw new Error('Reputation quota unavailable.'); }
    const within = (unit: 'minute' | 'hour', amount: number) => ({
      $filter: { input: '$requests', as: 'request', cond: {
        $gt: ['$$request', { $dateSubtract: { startDate: '$$NOW', unit, amount } }]
      } }
    });
    try {
      const result = await this.collection.findOneAndUpdate({
        _id: this.id,
        $expr: { $and: [
          { $lte: ['$cooldownUntil', '$$NOW'] },
          { $lt: [{ $size: within('minute', 1) }, 4] },
          { $lt: [{ $size: within('hour', 24) }, 500] }
        ] }
      }, [{ $set: { requests: { $concatArrays: [within('hour', 24), ['$$NOW']] } } }], { returnDocument: 'after' });
      return result !== null;
    } catch { throw new Error('Reputation quota unavailable.'); }
  }

  async cooldown(): Promise<void> {
    const result = await this.collection.updateOne({ _id: this.id }, [{ $set: {
      cooldownUntil: { $max: ['$cooldownUntil', { $dateAdd: { startDate: '$$NOW', unit: 'minute', amount: 1 } }] }
    } }]);
    if (result.matchedCount !== 1) throw new Error('Reputation quota cooldown unavailable.');
  }
}
