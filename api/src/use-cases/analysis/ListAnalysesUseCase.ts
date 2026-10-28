import { IDailyAnalysisRepository, PaginatedAttemptsResult } from '../../core/ports/IDailyAnalysisRepository.js';

export interface ListAnalysesInput {
  userId: string;
  limit?: number;
  cursor?: string;
  startDate?: string;
  endDate?: string;
}

export class ListAnalysesUseCase {
  constructor(private readonly dailyAnalysisRepository: IDailyAnalysisRepository) {}

  public async execute(input: ListAnalysesInput): Promise<PaginatedAttemptsResult> {
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);

    return this.dailyAnalysisRepository.listUserAttempts(input.userId, {
      limit,
      cursor: input.cursor,
      startDate: input.startDate,
      endDate: input.endDate
    });
  }
}
