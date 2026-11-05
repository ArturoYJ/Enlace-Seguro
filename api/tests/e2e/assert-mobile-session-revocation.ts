import { MongoClient, ObjectId } from 'mongodb';

const DATABASE_PATTERN = /^enlaceseguro_test_e2e_[a-z0-9_-]{1,64}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const email = process.env['TEST_EMAIL']?.trim().toLowerCase();
const mongoUri = process.env['MONGO_TEST_URI'];

if (!email || !mongoUri) {
  throw new Error('TEST_EMAIL and MONGO_TEST_URI are required.');
}

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
  const user = await db.collection<{ _id: ObjectId; emailNormalized: string }>('users').findOne({ emailNormalized: email });
  if (!user) throw new Error('Registered E2E account was not found in the disposable database.');

  const tokens = await db.collection<{ isRevoked: boolean }>('refresh_tokens').find({ userId: user._id }).toArray();
  if (tokens.length === 0 || tokens.some((token) => token.isRevoked !== true)) {
    throw new Error('Mobile logout did not revoke every refresh token for the synthetic E2E account.');
  }

  console.log('PASS: installed mobile logout revoked the synthetic account refresh tokens; token values were not read or printed.');
} finally {
  await client.close();
}
