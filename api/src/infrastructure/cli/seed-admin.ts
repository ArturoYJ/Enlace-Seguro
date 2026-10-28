import 'dotenv/config';
import { MongoDbConnection } from '../database/mongo/MongoDbConnection.js';
import { MongoUserRepository } from '../database/mongo/MongoUserRepository.js';
import { MongoSecurityAuditRepository } from '../database/mongo/MongoSecurityAuditRepository.js';
import { BcryptPasswordHasher } from '../security/BcryptPasswordHasher.js';

async function seedAdmin() {
  const mongoUri = process.env['MONGODB_URI'] || 'mongodb://localhost:27017';
  const dbName = process.env['MONGODB_DB_NAME'] || 'enlaceseguro_dev';

  const args = process.argv.slice(2);
  let emailArg = process.env['ADMIN_EMAIL'];
  let passwordArg = process.env['ADMIN_PASSWORD'];

  for (const arg of args) {
    if (arg.startsWith('--email=')) {
      emailArg = arg.substring(8);
    } else if (arg.startsWith('--password=')) {
      passwordArg = arg.substring(11);
    }
  }

  if (!emailArg || !passwordArg) {
    console.error('Usage: npm run seed:admin -- --email="admin@enlaceseguro.internal" --password="SuperSecurePassword123!"');
    console.error('Or set ADMIN_EMAIL and ADMIN_PASSWORD environment variables.');
    process.exit(1);
  }

  const emailNormalized = emailArg.trim().toLowerCase();

  const connection = new MongoDbConnection(mongoUri, dbName);
  const db = await connection.connect();

  const userRepo = new MongoUserRepository(db);
  const auditRepo = new MongoSecurityAuditRepository(db);
  const hasher = new BcryptPasswordHasher(12);

  try {
    const adminCount = await userRepo.countAdmins();
    if (adminCount > 0) {
      console.warn(`[WARN] An administrator account already exists (${adminCount} found). Aborting admin provisioning.`);
      process.exit(0);
    }

    const passwordHash = await hasher.hash(passwordArg);

    const adminUser = await userRepo.create({
      emailNormalized,
      passwordHash,
      role: 'admin',
      accountStatus: 'active'
    });

    await auditRepo.record({
      occurredAt: new Date(),
      purgeAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      eventType: 'account.registered',
      actorType: 'cli',
      actorId: adminUser.id,
      action: 'provision_admin',
      outcome: 'success',
      resourceType: 'user',
      resourceId: adminUser.id
    });

    console.log(`[SUCCESS] Admin account successfully provisioned: ${emailNormalized} (id: ${adminUser.id})`);
  } catch (error) {
    console.error('[ERROR] Failed to provision admin account:', error);
    process.exit(1);
  } finally {
    await connection.disconnect();
  }
}

seedAdmin();
