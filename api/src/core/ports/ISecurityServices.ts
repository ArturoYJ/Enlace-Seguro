import { UserRole } from '../entities/User.js';

export interface IPasswordHasher {
  hash(password: string): Promise<string>;
  compare(password: string, hash: string): Promise<boolean>;
}

export interface AccessTokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  jti?: string;
}

export interface DecodedAccessToken {
  userId: string;
  email: string;
  role: UserRole;
  jti: string;
  iat: number;
  exp: number;
}

export interface ITokenService {
  generateAccessToken(payload: AccessTokenPayload): string;
  verifyAccessToken(token: string): DecodedAccessToken;
  generateRefreshToken(): string;
  hashToken(token: string): string;
}
