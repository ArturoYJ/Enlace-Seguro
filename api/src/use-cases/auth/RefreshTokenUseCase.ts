import { IUserRepository } from '../../core/ports/IUserRepository.js';
import { IRefreshTokenRepository } from '../../core/ports/IRefreshTokenRepository.js';
import { ISecurityAuditRepository } from '../../core/ports/ISecurityAuditRepository.js';
import { ITokenService } from '../../core/ports/ISecurityServices.js';
import {
  TokenExpiredOrInvalidError,
  TokenReuseDetectedError,
  AccountDisabledError
} from '../../core/errors/DomainErrors.js';
import { TokenResponseDTO } from './LoginUserUseCase.js';

export interface RefreshTokenInput {
  refreshToken: string;
  requestId?: string;
}

export class RefreshTokenUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly refreshTokenRepository: IRefreshTokenRepository,
    private readonly securityAuditRepository: ISecurityAuditRepository,
    private readonly tokenService: ITokenService,
    private readonly accessTokenExpiresInSeconds: number = 900,
    private readonly refreshTokenExpiresInDays: number = 7
  ) {}

  public async execute(input: RefreshTokenInput): Promise<TokenResponseDTO> {
    if (!input.refreshToken || typeof input.refreshToken !== 'string') {
      throw new TokenExpiredOrInvalidError('Refresh token must be provided.');
    }

    const tokenHash = this.tokenService.hashToken(input.refreshToken);
    const storedToken = await this.refreshTokenRepository.findByHash(tokenHash);

    if (!storedToken) {
      throw new TokenExpiredOrInvalidError('Refresh token was not recognized or has already expired.');
    }

    const now = new Date();

    // Replay attack / Token Reuse Detection
    if (storedToken.isRevoked) {
      await this.refreshTokenRepository.revokeByFamilyId(storedToken.familyId);

      await this.securityAuditRepository.record({
        occurredAt: now,
        purgeAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
        eventType: 'authz.denied',
        actorType: 'user',
        actorId: storedToken.userId,
        action: 'refresh_token',
        outcome: 'denied',
        resourceType: 'token_family',
        resourceId: storedToken.familyId,
        requestId: input.requestId,
        metadata: { reasonCode: 'token_reuse_detected' }
      });

      throw new TokenReuseDetectedError();
    }

    if (storedToken.isExpired(now)) {
      throw new TokenExpiredOrInvalidError('Refresh token has expired.');
    }

    const user = await this.userRepository.findById(storedToken.userId);
    if (!user || !user.isActive()) {
      throw new AccountDisabledError();
    }

    // Invalidate the consumed token (Strict Rotation)
    await this.refreshTokenRepository.revokeById(storedToken.id);

    // Issue new token pair preserving the family
    const newAccessToken = this.tokenService.generateAccessToken({
      userId: user.id,
      email: user.emailNormalized,
      role: user.role
    });

    const newRawRefreshToken = this.tokenService.generateRefreshToken();
    const newTokenHash = this.tokenService.hashToken(newRawRefreshToken);
    const expiresAt = new Date(now.getTime() + this.refreshTokenExpiresInDays * 24 * 60 * 60 * 1000);

    await this.refreshTokenRepository.create({
      userId: user.id,
      tokenHash: newTokenHash,
      familyId: storedToken.familyId,
      isRevoked: false,
      createdAt: now,
      expiresAt
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRawRefreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTokenExpiresInSeconds
    };
  }
}
