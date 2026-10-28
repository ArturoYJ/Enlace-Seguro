import { RefreshToken } from '../entities/RefreshToken.js';

export interface CreateRefreshTokenData {
  userId: string;
  tokenHash: string;
  familyId: string;
  isRevoked: boolean;
  createdAt: Date;
  expiresAt: Date;
}

export interface IRefreshTokenRepository {
  create(data: CreateRefreshTokenData): Promise<RefreshToken>;
  findByHash(tokenHash: string): Promise<RefreshToken | null>;
  revokeById(id: string): Promise<void>;
  revokeByFamilyId(familyId: string): Promise<number>;
  revokeAllByUserId(userId: string): Promise<number>;
}
