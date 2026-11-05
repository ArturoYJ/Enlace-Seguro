import { createHash } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { AesGcmAnalysisInputCipher } from '../../src/infrastructure/security/AesGcmAnalysisInputCipher.js';
import type { EncryptedAnalysisInput } from '../../src/core/ports/IAnalysisInputCipher.js';

const DATABASE_PATTERN = /^enlaceseguro_test_e2e_[a-z0-9_-]{1,64}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const email = process.env['QUOTA_TEST_EMAIL']?.trim().toLowerCase();
const mongoUri = process.env['MONGO_TEST_URI'];

if (!email || !mongoUri) throw new Error('QUOTA_TEST_EMAIL and MONGO_TEST_URI are required.');

const parsedMongoUri = new URL(mongoUri);
const databaseName = decodeURIComponent(parsedMongoUri.pathname.replace(/^\//, ''));
if (parsedMongoUri.protocol !== 'mongodb:' || !LOOPBACK_HOSTS.has(parsedMongoUri.hostname.toLowerCase()) || !DATABASE_PATTERN.test(databaseName)) {
  throw new Error('Refusing to inspect a non-disposable or non-loopback mobile E2E database.');
}

const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5_000 });

try {
  await client.connect();
  const db = client.db(databaseName);
  const user = await db.collection<{ _id: ObjectId; emailNormalized: string }>('users').findOne({ emailNormalized: email });
  if (!user) throw new Error('Quota boundary E2E account was not found in the disposable database.');

  const records = await db.collection<{
    localDate: string;
    userId: ObjectId;
    attempts: Array<{
      attemptId: string;
      processingStatus: string;
      inputDigest: string;
      inputSizeBytes: number;
      submittedInput?: string;
      submittedInputEncrypted?: EncryptedAnalysisInput;
      analysis?: { verdict?: string };
    }>;
  }>('daily_analyses').find({ userId: user._id }).toArray();
  const attempts = records.flatMap((record) => record.attempts.map((attempt) => ({ ...attempt, localDate: record.localDate })));

  if (attempts.length !== 5) throw new Error(`Expected exactly five persisted attempts; found ${attempts.length}.`);
  const cipher = new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0xe2));
  const expectedInputs = new Set(Array.from({ length: 5 }, (_, index) => `https://example.test/quota-attempt-${index + 1}`));
  const storedInputs = new Set<string>();
  for (const attempt of attempts) {
    if (attempt.submittedInput !== undefined || !attempt.submittedInputEncrypted) {
      throw new Error('Every admitted quota attempt must be encrypted with no plaintext copy.');
    }
    const storedInput = cipher.decrypt(attempt.submittedInputEncrypted, {
      userId: user._id.toHexString(),
      localDate: attempt.localDate,
      attemptId: attempt.attemptId
    });
    const digest = createHash('sha256').update(storedInput, 'utf8').digest('hex');
    if (!expectedInputs.has(storedInput) || attempt.inputDigest !== digest || attempt.inputSizeBytes !== Buffer.byteLength(storedInput, 'utf8') ||
        attempt.processingStatus !== 'completed' || attempt.analysis?.verdict !== 'sospechoso') {
      throw new Error('A persisted attempt does not match a completed expected quota input.');
    }
    storedInputs.add(storedInput);
  }
  if (storedInputs.size !== 5) throw new Error('Expected five unique quota URLs; a URL is missing or duplicated.');

  const capacity = await db.collection<{ _id: string; pendingCount: number }>('analysis_queue_capacity').findOne({ _id: 'global' });
  if (!capacity || capacity.pendingCount !== 0) throw new Error('The quota boundary run must leave no queued analysis jobs.');
  console.log('PASS: five unique mobile analyses were admitted/completed; no sixth attempt was persisted; stored URLs remain encrypted.');
} finally {
  await client.close();
}
