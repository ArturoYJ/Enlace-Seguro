import { Db, ObjectId } from 'mongodb';
import { IUserRepository, CreateUserData } from '../../../core/ports/IUserRepository.js';
import { User, UserRole, AccountStatus } from '../../../core/entities/User.js';

interface UserDoc {
  _id: ObjectId;
  schemaVersion: number;
  emailNormalized: string;
  passwordHash: string;
  role: UserRole;
  accountStatus: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class MongoUserRepository implements IUserRepository {
  constructor(private readonly db: Db) {}

  private get collection() {
    return this.db.collection<UserDoc>('users');
  }

  public async findById(id: string): Promise<User | null> {
    if (!ObjectId.isValid(id)) {
      return null;
    }
    const doc = await this.collection.findOne({ _id: new ObjectId(id) });
    return doc ? this.toEntity(doc) : null;
  }

  public async findByEmail(emailNormalized: string): Promise<User | null> {
    const doc = await this.collection.findOne({ emailNormalized });
    return doc ? this.toEntity(doc) : null;
  }

  public async create(data: CreateUserData): Promise<User> {
    const now = new Date();
    const doc: Omit<UserDoc, '_id'> = {
      schemaVersion: 1,
      emailNormalized: data.emailNormalized,
      passwordHash: data.passwordHash,
      role: data.role,
      accountStatus: data.accountStatus,
      createdAt: now,
      updatedAt: now
    };

    const result = await this.collection.insertOne(doc as UserDoc);
    return new User({
      id: result.insertedId.toHexString(),
      emailNormalized: data.emailNormalized,
      passwordHash: data.passwordHash,
      role: data.role,
      accountStatus: data.accountStatus,
      createdAt: now,
      updatedAt: now
    });
  }

  public async countAdmins(): Promise<number> {
    return this.collection.countDocuments({ role: 'admin' });
  }

  private toEntity(doc: UserDoc): User {
    return new User({
      id: doc._id.toHexString(),
      emailNormalized: doc.emailNormalized,
      passwordHash: doc.passwordHash,
      role: doc.role,
      accountStatus: doc.accountStatus,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    });
  }
}
