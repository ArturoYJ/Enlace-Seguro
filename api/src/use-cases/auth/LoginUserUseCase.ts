import { randomUUID } from 'node:crypto';
import { IUserRepository } from '../../core/ports/IUserRepository.js';
import { IRefreshTokenRepository } from '../../core/ports/IRefreshTokenRepository.js';
import { ISecurityAuditRepository } from '../../core/ports/ISecurityAuditRepository.js';
import { IPasswordHasher, ITokenService } from '../../core/ports/ISecurityServices.js';
import { InvalidCredentialsError, AccountDisabledError } from '../../core/errors/DomainErrors.js';

export interface LoginUserInput {
  email: string;
  password: string;
  requestId?: string;
}

export interface TokenResponseDTO {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export class LoginUserUseCase {
  private static readonly DUMMY_HASH =
    '$2b$12$e7k1j3rW3bV19J3cT2u4LeqW1O8e1J9cT2u4LeqW1O8e1J9cT2u4L';

  constructor(
    private readonly userRepository: IUserRepository,
    private readonly refreshTokenRepository: IRefreshTokenRepository,
    private readonly securityAuditRepository: ISecurityAuditRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly tokenService: ITokenService,
    private readonly accessTokenExpiresInSeconds: number = 900,
    private readonly refreshTokenExpiresInDays: number = 7
  ) {}

  public async execute(input: LoginUserInput): Promise<TokenResponseDTO> {
    const emailNormalized = input.email.trim().toLowerCase();
    const user = await this.userRepository.findByEmail(emailNormalized);

    if (!user) {
      await this.passwordHasher.compare(input.password, LoginUserUseCase.DUMMY_HASH);
      await this.recordFailure(undefined, 'user_not_found', input.requestId);
      throw new InvalidCredentialsError();
    }

    if (!user.isActive()) {
      await this.passwordHasher.compare(input.password, user.passwordHash);
      await this.recordFailure(user.id, 'account_disabled', input.requestId);
      throw new AccountDisabledError();
    }

    const isPasswordValid = await this.passwordHasher.compare(input.password, user.passwordHash);
    if (!isPasswordValid) {
      await this.recordFailure(user.id, 'invalid_password', input.requestId);
      throw new InvalidCredentialsError();
    }

    const accessToken = this.tokenService.generateAccessToken({
      userId: user.id,
      email: user.emailNormalized,
      role: user.role
    });

    const rawRefreshToken = this.tokenService.generateRefreshToken();
    const tokenHash = this.tokenService.hashToken(rawRefreshToken);
    const familyId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.refreshTokenExpiresInDays * 24 * 60 * 60 * 1000);

    await this.refreshTokenRepository.create({
      userId: user.id,
      tokenHash,
      familyId,
      isRevoked: false,
      createdAt: now,
      expiresAt
    });

    await this.securityAuditRepository.record({
      occurredAt: now,
      purgeAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      eventType: 'auth.login.succeeded',
      actorType: 'user',
      actorId: user.id,
      action: 'login',
      outcome: 'success',
      resourceType: 'session',
      requestId: input.requestId
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTokenExpiresInSeconds
    };
  }

  private async recordFailure(actorId?: string, reasonCode?: string, requestId?: string): Promise<void> {
    const now = new Date();
    await this.securityAuditRepository.record({
      occurredAt: now,
      purgeAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      eventType: 'auth.login.failed',
      actorType: actorId ? 'user' : undefined,
      actorId,
      action: 'login',
      outcome: 'failure',
      resourceType: 'session',
      requestId,
      metadata: reasonCode ? { reasonCode } : undefined
    });
  }
}
