import { IRefreshTokenRepository } from '../../core/ports/IRefreshTokenRepository.js';
import { ITokenService } from '../../core/ports/ISecurityServices.js';

export interface LogoutUserInput {
  refreshToken: string;
  userId?: string;
  allDevices?: boolean;
}

export class LogoutUserUseCase {
  constructor(
    private readonly refreshTokenRepository: IRefreshTokenRepository,
    private readonly tokenService: ITokenService
  ) {}

  public async execute(input: LogoutUserInput): Promise<void> {
    if (!input.refreshToken) {
      return;
    }

    if (input.allDevices && input.userId) {
      await this.refreshTokenRepository.revokeAllByUserId(input.userId);
      return;
    }

    const tokenHash = this.tokenService.hashToken(input.refreshToken);
    const storedToken = await this.refreshTokenRepository.findByHash(tokenHash);

    if (storedToken) {
      await this.refreshTokenRepository.revokeById(storedToken.id);
    }
  }
}
