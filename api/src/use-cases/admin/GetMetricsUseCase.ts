import { IDailyAnalysisRepository, AdminMetricsResult } from '../../core/ports/IDailyAnalysisRepository.js';
import { UnauthorizedAccessError, ValidationError } from '../../core/errors/DomainErrors.js';
import { UserRole } from '../../core/entities/User.js';

export interface GetMetricsInput {
  requestingRole: UserRole;
  startDate: string;
  endDate: string;
}

export class GetMetricsUseCase {
  constructor(private readonly dailyAnalysisRepository: IDailyAnalysisRepository) {}

  public async execute(input: GetMetricsInput): Promise<AdminMetricsResult> {
    if (input.requestingRole !== 'admin') {
      throw new UnauthorizedAccessError('Only administrators can access analytical metrics.');
    }

    if (!input.startDate || !input.endDate) {
      throw new ValidationError('Both startDate and endDate are required query parameters.');
    }

    return this.dailyAnalysisRepository.getMetrics(input.startDate, input.endDate);
  }
}
