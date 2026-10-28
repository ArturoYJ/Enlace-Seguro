import { IDailyAnalysisRepository } from '../../core/ports/IDailyAnalysisRepository.js';
import { ISecurityAuditRepository } from '../../core/ports/ISecurityAuditRepository.js';
import { ISandboxService } from '../../core/ports/ISandboxService.js';
import { AnalysisPayload } from '../../core/entities/Analysis.js';

export interface ProcessAnalysisJobInput {
  userId: string;
  localDate: string;
  attemptId: string;
  targetUrl: string;
}

export class ProcessAnalysisJobUseCase {
  constructor(
    private readonly dailyAnalysisRepository: IDailyAnalysisRepository,
    private readonly securityAuditRepository: ISecurityAuditRepository,
    private readonly sandboxService: ISandboxService
  ) {}

  public async execute(input: ProcessAnalysisJobInput): Promise<void> {
    // 1. Transition attempt to 'processing'
    await this.dailyAnalysisRepository.updateAttempt(input.userId, input.localDate, input.attemptId, {
      processingStatus: 'processing'
    });

    try {
      // 2. Dispatch isolated analysis in sandbox pool
      const result = await this.sandboxService.analyze(input.attemptId, input.targetUrl);

      // 3. Format structured AnalysisPayload
      const analysis: AnalysisPayload = {
        verdict: result.verdict,
        reasons: result.reasons.slice(0, 10),
        finalDestination: result.finalDestination.slice(0, 8192),
        sourceResults: result.sourceResults.slice(0, 4),
        sourceFailures: [],
        signals: result.signals.slice(0, 50),
        redirects: result.redirects.slice(0, 10),
        screenshotRef: result.screenshotRef
      };

      const now = new Date();

      // 4. Update attempt with terminal completed status and analytical result
      await this.dailyAnalysisRepository.updateAttempt(input.userId, input.localDate, input.attemptId, {
        processingStatus: 'completed',
        completedAt: now,
        analysis
      });

      // 5. Record audit event
      await this.securityAuditRepository.record({
        occurredAt: now,
        purgeAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
        eventType: 'analysis.completed',
        actorType: 'user',
        actorId: input.userId,
        action: 'process_analysis',
        outcome: 'success',
        resourceType: 'attempt',
        resourceId: input.attemptId,
        metadata: {
          analysisStatus: 'completed'
        }
      });
    } catch (err: unknown) {
      const now = new Date();

      // Fallback to failed status upon critical error
      await this.dailyAnalysisRepository.updateAttempt(input.userId, input.localDate, input.attemptId, {
        processingStatus: 'failed',
        completedAt: now
      });

      await this.securityAuditRepository.record({
        occurredAt: now,
        purgeAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
        eventType: 'analysis.failed',
        actorType: 'user',
        actorId: input.userId,
        action: 'process_analysis',
        outcome: 'failure',
        resourceType: 'attempt',
        resourceId: input.attemptId,
        metadata: {
          analysisStatus: 'failed',
          reasonCode: err instanceof Error ? err.message.slice(0, 64) : 'sandbox_error'
        }
      });
    }
  }
}
