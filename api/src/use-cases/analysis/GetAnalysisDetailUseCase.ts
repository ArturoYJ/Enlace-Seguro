import { IDailyAnalysisRepository } from '../../core/ports/IDailyAnalysisRepository.js';
import { ResourceNotFoundError } from '../../core/errors/DomainErrors.js';
import { AttemptProps } from '../../core/entities/Analysis.js';
import { UserRole } from '../../core/entities/User.js';

export interface GetAnalysisDetailInput {
  attemptId: string;
  requestingUser: {
    userId: string;
    role: UserRole;
  };
  localDate?: string;
}

export interface AnalysisDetailDTO {
  attemptId: string;
  localDate: string;
  receivedAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  processingStatus: AttemptProps['processingStatus'];
  submittedInput?: string;
  inputDigest: string;
  inputSizeBytes: number;
  analysis?: AttemptProps['analysis'];
}

export class GetAnalysisDetailUseCase {
  constructor(private readonly dailyAnalysisRepository: IDailyAnalysisRepository) {}

  public async execute(input: GetAnalysisDetailInput): Promise<AnalysisDetailDTO> {
    const isRegularUser = input.requestingUser.role !== 'admin';

    let matchResult: { dailyAnalysis: { userId: string; localDate: string }; attempt: AttemptProps } | null = null;

    if (input.localDate && isRegularUser) {
      matchResult = await this.dailyAnalysisRepository.findAttemptByLocalKey(
        input.requestingUser.userId,
        input.localDate,
        input.attemptId
      );
    } else {
      matchResult = await this.dailyAnalysisRepository.findAttemptGlobally(input.attemptId);
    }

    if (!matchResult) {
      throw new ResourceNotFoundError('Analysis attempt', input.attemptId);
    }

    if (isRegularUser && matchResult.dailyAnalysis.userId !== input.requestingUser.userId) {
      throw new ResourceNotFoundError('Analysis attempt', input.attemptId);
    }

    const { attempt, dailyAnalysis } = matchResult;

    return {
      attemptId: attempt.attemptId,
      localDate: dailyAnalysis.localDate,
      receivedAt: attempt.receivedAt,
      updatedAt: attempt.updatedAt,
      completedAt: attempt.completedAt,
      processingStatus: attempt.processingStatus,
      submittedInput: attempt.submittedInput,
      inputDigest: attempt.inputDigest,
      inputSizeBytes: attempt.inputSizeBytes,
      analysis: attempt.analysis
    };
  }
}
