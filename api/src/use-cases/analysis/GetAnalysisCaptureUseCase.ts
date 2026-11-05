import { IDailyAnalysisRepository } from '../../core/ports/IDailyAnalysisRepository.js';
import { ISandboxService } from '../../core/ports/ISandboxService.js';
import { CaptureUnavailableError, ResourceNotFoundError, SandboxServiceError } from '../../core/errors/DomainErrors.js';

/** Capture access is deliberately owner-only, including for administrators. */
export class GetAnalysisCaptureUseCase {
  constructor(
    private readonly repository: IDailyAnalysisRepository,
    private readonly sandbox: ISandboxService
  ) {}

  public async execute(userId: string, attemptId: string): Promise<Uint8Array> {
    const found = await this.repository.findAttemptGlobally(attemptId);
    if (!found || found.dailyAnalysis.userId !== userId || found.attempt.processingStatus !== 'completed' ||
      !found.attempt.analysis?.screenshotRef) {
      throw new ResourceNotFoundError('Analysis capture');
    }
    let image: Uint8Array | null;
    try {
      image = await this.sandbox.getCapture(attemptId);
    } catch (error) {
      if (error instanceof SandboxServiceError) throw new CaptureUnavailableError();
      throw error;
    }
    if (!image) throw new ResourceNotFoundError('Analysis capture');
    return image;
  }
}
