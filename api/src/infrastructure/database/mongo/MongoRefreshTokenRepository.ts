import { Db, ObjectId } from 'mongodb';
import { IRefreshTokenRepository, CreateRefreshTokenData } from '../../../core/ports/IRefreshTokenRepository.js';
import { RefreshToken } from '../../../core/entities/RefreshToken.js';

interface RefreshTokenDoc {
  _id: ObjectId;
  schemaVersion: number;
  userId: ObjectId;
  tokenHash: string;
  familyId: string;
  isRevoked: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export class MongoRefreshTokenRepository implements IRefreshTokenRepository {
  constructor(private readonly db: Db) {}

  private get collection() {
    return this.db.collection<RefreshTokenDoc>('refresh_tokens');
  }

  public async create(data: CreateRefreshTokenData): Promise<RefreshToken> {
    const doc: Omit<RefreshTokenDoc, '_id'> = {
      schemaVersion: 1,
      userId: new ObjectId(data.userId),
      tokenHash: data.tokenHash,
      familyId: data.familyId,
      isRevoked: data.isRevoked,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt
    };

    const result = await this.collection.insertOne(doc as RefreshTokenDoc);
    return new RefreshToken({
      id: result.insertedId.toHexString(),
      userId: data.userId,
      tokenHash: data.tokenHash,
      familyId: data.familyId,
      isRevoked: data.isRevoked,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt
    });
  }

  public async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    const doc = await this.collection.findOne({ tokenHash });
    return doc ? this.toEntity(doc) : null;
  }

  public async revokeById(id: string): Promise<void> {
    if (!ObjectId.isValid(id)) {
      return;
    }
    await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: { isRevoked: true } });
  }

  public async revokeByFamilyId(familyId: string): Promise<number> {
    const result = await this.collection.updateMany({ familyId }, { $set: { isRevoked: true } });
    return result.modifiedCount;
  }

  public async revokeAllByUserId(userId: string): Promise<number> {
    if (!ObjectId.isValid(userId)) {
      return 0;
    }
    const result = await this.collection.updateMany(
      { userId: new ObjectId(userId) },
      { $set: { isRevoked: true } }
    );
    return result.modifiedCount;
  }

  private toEntity(doc: RefreshTokenDoc): RefreshToken {
    return new RefreshToken({
      id: doc._id.toHexString(),
      userId: doc.userId.toHexString(),
      tokenHash: doc.tokenHash,
      familyId: doc.familyId,
      isRevoked: doc.isRevoked,
      createdAt: doc.createdAt,
      expiresAt: doc.expiresAt
    });
  }
}
