import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from 'mongodb';
import { MongoReputationQuota } from '../../../src/infrastructure/reputation/MongoReputationQuota.js';

describe('MongoReputationQuota', () => {
  it('reserves with a single atomic update and database-clock rolling bounds', async () => {
    const calls: unknown[][] = [];
    const collection = { updateOne: async (...args: unknown[]) => { calls.push(args); return { matchedCount: 1 }; },
      findOneAndUpdate: async (...args: unknown[]) => { calls.push(args); return { requests: [] }; } };
    const db = { collection: () => collection } as unknown as Db;
    const quota = new MongoReputationQuota(db, 'private-test-key');
    assert.equal(await quota.reserve(), true);
    const filterAndUpdate = JSON.stringify(calls[1]);
    assert.match(filterAndUpdate, /\$\$NOW/);
    assert.match(filterAndUpdate, /\$dateSubtract/);
    assert.doesNotMatch(JSON.stringify(calls), /private-test-key/);
    await quota.cooldown();
    assert.match(JSON.stringify(calls[2]), /\$dateAdd/);
  });

  it('rejects a full quota and fails closed on database errors', async () => {
    let fail = false;
    const collection = { updateOne: async () => { if (fail) throw new Error('db down'); return { matchedCount: 1 }; },
      findOneAndUpdate: async () => null };
    const quota = new MongoReputationQuota({ collection: () => collection } as unknown as Db, 'test-key');
    assert.equal(await quota.reserve(), false);
    fail = true;
    await assert.rejects(quota.reserve(), /quota unavailable/);
    await assert.rejects(quota.cooldown());
  });
});
