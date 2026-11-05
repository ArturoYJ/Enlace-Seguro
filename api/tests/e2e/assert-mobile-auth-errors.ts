import { MongoClient, ObjectId } from 'mongodb';

const DATABASE_PATTERN = /^enlaceseguro_test_e2e_[a-z0-9_-]{1,64}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const email = process.env['AUTH_TEST_EMAIL']?.trim().toLowerCase();
const mongoUri = process.env['MONGO_TEST_URI'];

if (!email || !mongoUri) throw new Error('AUTH_TEST_EMAIL and MONGO_TEST_URI are required.');

const parsedMongoUri = new URL(mongoUri);
const databaseName = decodeURIComponent(parsedMongoUri.pathname.replace(/^\//, ''));
if (parsedMongoUri.protocol !== 'mongodb:' || !LOOPBACK_HOSTS.has(parsedMongoUri.hostname.toLowerCase()) ||
    !DATABASE_PATTERN.test(databaseName)) {
  throw new Error('Refusing to inspect a non-disposable or non-loopback mobile E2E database.');
}

const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5_000 });

try {
  await client.connect();
  const db = client.db(databaseName);
  const users = db.collection<{ _id: ObjectId; emailNormalized: string }>('users');
  const matchingUsers = await users.find({ emailNormalized: email }, { projection: { _id: 1 } }).toArray();
  if (matchingUsers.length !== 1) {
    throw new Error('Authentication E2E must create exactly one synthetic account.');
  }

  const tokens = await db.collection<{ isRevoked: boolean }>('refresh_tokens')
    .find({ userId: matchingUsers[0]!._id }, { projection: { _id: 1, isRevoked: 1 } })
    .toArray();
  if (tokens.length !== 1 || tokens[0]!.isRevoked !== false) {
    throw new Error('Authentication E2E must leave one active refresh token after successful login.');
  }

  console.log('PASS: synthetic auth E2E created one account and one active session; no credential/token values were read or printed.');
} finally {
  await client.close();
}
