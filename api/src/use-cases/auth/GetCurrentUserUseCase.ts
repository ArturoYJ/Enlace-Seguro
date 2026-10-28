import { IUserRepository } from '../../core/ports/IUserRepository.js';
import { IDailyAnalysisRepository } from '../../core/ports/IDailyAnalysisRepository.js';
import { ResourceNotFoundError, AccountDisabledError } from '../../core/errors/DomainErrors.js';
import { getLocalDate, getNextLocalMidnight } from '../../core/utils/dateUtils.js';
import { UserRole, AccountStatus } from '../../core/entities/User.js';

export interface UserProfileDTO {
  user: {
    id: string;
    email: string;
    role: UserRole;
    accountStatus: AccountStatus;
    createdAt: Date;
  };
  quota: {
    localDate: string;
    timezone: string;
    limit: number;
    used: number;
    remaining: number;
    resetAt: string;
  };
}

export class GetCurrentUserUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly dailyAnalysisRepository: IDailyAnalysisRepository,
    private readonly timezone = 'America/Mexico_City',
    private readonly dailyLimit = 5
  ) {}

  public async execute(userId: string): Promise<UserProfileDTO> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new ResourceNotFoundError('User', userId);
    }

    if (!user.isActive()) {
      throw new AccountDisabledError();
    }

    const todayLocalDate = getLocalDate(new Date(), this.timezone);
    const dailyRecord = await this.dailyAnalysisRepository.findDailyAnalysis(userId, todayLocalDate);

    const used = dailyRecord ? dailyRecord.attemptsCount : 0;
    const remaining = Math.max(0, this.dailyLimit - used);
    const resetAt = getNextLocalMidnight(new Date(), this.timezone).toISOString();

    return {
      user: {
        id: user.id,
        email: user.emailNormalized,
        role: user.role,
        accountStatus: user.accountStatus,
        createdAt: user.createdAt
      },
      quota: {
        localDate: todayLocalDate,
        timezone: this.timezone,
        limit: this.dailyLimit,
        used,
        remaining,
        resetAt
      }
    };
  }
}
