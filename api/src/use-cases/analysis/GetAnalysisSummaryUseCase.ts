import { IDailyAnalysisRepository } from '../../core/ports/IDailyAnalysisRepository.js';

const SUMMARY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export interface UserAnalysisSummary {
  window: {
    startsAtInclusive: string;
    endsAtExclusive: string;
  };
  total: number;
  dangerous: number;
  suspicious: number;
}

export class GetAnalysisSummaryUseCase {
  constructor(
    private readonly dailyAnalysisRepository: IDailyAnalysisRepository,
    private readonly clock: () => Date = () => new Date()
  ) {}

  public async execute(userId: string): Promise<UserAnalysisSummary> {
    const end = this.clock();
    if (Number.isNaN(end.getTime())) throw new Error('The analysis summary clock returned an invalid date.');
    const startsAt = new Date(end.getTime() - SUMMARY_WINDOW_MS);
    const counts = await this.dailyAnalysisRepository.getUserAnalysisSummary(userId, startsAt, end);

    return {
      window: {
        startsAtInclusive: startsAt.toISOString(),
        endsAtExclusive: end.toISOString()
      },
      ...counts
    };
  }
}
