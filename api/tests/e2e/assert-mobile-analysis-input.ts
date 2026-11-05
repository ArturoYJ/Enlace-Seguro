import { createHash } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { AesGcmAnalysisInputCipher } from '../../src/infrastructure/security/AesGcmAnalysisInputCipher.js';
import type { EncryptedAnalysisInput } from '../../src/core/ports/IAnalysisInputCipher.js';

const DATABASE_PATTERN = /^enlaceseguro_test_e2e_[a-z0-9_-]{1,64}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const expectedInput = process.env['E2E_EXPECTED_ANALYSIS_INPUT'];
const expectedInconclusiveInput = process.env['E2E_EXPECTED_INCONCLUSIVE_INPUT'];
const expectedFailedInput = process.env['E2E_EXPECTED_FAILED_INPUT'];
const email = process.env['TEST_EMAIL']?.trim().toLowerCase();
const mongoUri = process.env['MONGO_TEST_URI'];

if (!expectedInput || !expectedInconclusiveInput || !expectedFailedInput || !email || !mongoUri) {
  throw new Error('E2E_EXPECTED_ANALYSIS_INPUT, E2E_EXPECTED_INCONCLUSIVE_INPUT, E2E_EXPECTED_FAILED_INPUT, TEST_EMAIL, and MONGO_TEST_URI are required.');
}

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
  if (!user) throw new Error('Registered E2E account was not found in the disposable database.');

  const records = await db.collection<{
    localDate: string;
    userId: ObjectId;
    attempts: Array<{
      attemptId: string;
      receivedAt: Date;
      inputDigest: string;
      inputSizeBytes: number;
      processingStatus: string;
      analysis?: { verdict?: string; screenshotRef?: string };
      submittedInput?: string;
      submittedInputEncrypted?: EncryptedAnalysisInput;
    }>;
  }>('daily_analyses').find({ userId: user._id }).toArray();
  const attempts = records.flatMap((record) => record.attempts.map((attempt) => ({ ...attempt, localDate: record.localDate })));

  if (attempts.length !== 3) throw new Error('Expected exactly three analyses from the fresh mobile E2E account.');
  const cipher = new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0xe2));
  const storedByInput = new Map<string, (typeof attempts)[number]>();
  for (const attempt of attempts) {
    if (attempt.submittedInput !== undefined || !attempt.submittedInputEncrypted) {
      throw new Error('Analysis input must be stored encrypted with no plaintext copy.');
    }
    const storedInput = cipher.decrypt(attempt.submittedInputEncrypted, {
      userId: user._id.toHexString(),
      localDate: attempt.localDate,
      attemptId: attempt.attemptId
    });
    const expectedDigest = createHash('sha256').update(storedInput, 'utf8').digest('hex');
    if (attempt.inputDigest !== expectedDigest || attempt.inputSizeBytes !== Buffer.byteLength(storedInput, 'utf8')) {
      throw new Error('Stored input digest or byte size does not match its decrypted value.');
    }
    if (![expectedInput, expectedInconclusiveInput, expectedFailedInput].includes(storedInput) || storedByInput.has(storedInput)) {
      throw new Error('Stored inputs must match the three expected synthetic URLs exactly once.');
    }
    storedByInput.set(storedInput, attempt);
  }

  if (storedByInput.size !== 3) throw new Error('All expected synthetic inputs must be present.');
  const completed = storedByInput.get(expectedInput);
  if (!completed || completed.processingStatus !== 'completed' || completed.analysis?.verdict !== 'sospechoso') {
    throw new Error('The completed fixture must persist the expected synthetic verdict.');
  }
  const inconclusive = storedByInput.get(expectedInconclusiveInput);
  if (!inconclusive || inconclusive.processingStatus !== 'inconclusive' || inconclusive.analysis !== undefined) {
    throw new Error('The inconclusive fixture must persist no verdict or analysis payload.');
  }
  const failed = storedByInput.get(expectedFailedInput);
  if (!failed || failed.processingStatus !== 'failed' || failed.analysis !== undefined) {
    throw new Error('The failed fixture must persist no verdict or analysis payload.');
  }

  console.log('PASS: completed, inconclusive, and failed inputs were encrypted; only completed contains the expected verdict.');
} finally {
  await client.close();
}
