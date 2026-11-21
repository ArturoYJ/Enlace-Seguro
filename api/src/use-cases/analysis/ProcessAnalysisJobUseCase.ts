import { ClaimedAnalysisJob, IDailyAnalysisRepository } from '../../core/ports/IDailyAnalysisRepository.js';
import { ISecurityAuditRepository } from '../../core/ports/ISecurityAuditRepository.js';
import { ISandboxService } from '../../core/ports/ISandboxService.js';
import { AnalysisPayload } from '../../core/entities/Analysis.js';
import { IReputationService } from '../../core/ports/IReputationService.js';
import { SandboxServiceError } from '../../core/errors/DomainErrors.js';

export class ProcessAnalysisJobUseCase {
  constructor(
    private readonly dailyAnalysisRepository: IDailyAnalysisRepository,
    private readonly securityAuditRepository: ISecurityAuditRepository,
    private readonly sandboxService: ISandboxService,
    private readonly maxAttempts = 4,
    private readonly reputationService?: IReputationService
  ) {}

  public async execute(job: ClaimedAnalysisJob): Promise<void> {
    if (job.leaseExhausted) {
      const now = new Date();
      await this.securityAuditRepository.record({
        occurredAt: now,
        purgeAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
        eventType: 'analysis.failed',
        actorType: 'user',
        actorId: job.userId,
        action: 'process_analysis',
        outcome: 'failure',
        resourceType: 'attempt',
        resourceId: job.attemptId,
        metadata: { analysisStatus: 'failed', reasonCode: 'worker_lease_exhausted' }
      });
      return;
    }

    try {
      const result = await this.sandboxService.analyze(job.attemptId, job.targetUrl);

      if (result.outcome === 'inconclusive') {
        const completedAt = new Date();
        const persisted = await this.dailyAnalysisRepository.failClaimedAnalysisJob(
          job,
          completedAt,
          'inconclusive',
          result.reasonCode
        );
        if (!persisted) return;

        await this.securityAuditRepository.record({
          occurredAt: completedAt,
          purgeAt: new Date(completedAt.getTime() + 90 * 24 * 60 * 60 * 1000),
          eventType: 'analysis.inconclusive',
          actorType: 'user',
          actorId: job.userId,
          action: 'process_analysis',
          outcome: 'partial',
          resourceType: 'attempt',
          resourceId: job.attemptId,
          metadata: { analysisStatus: 'inconclusive', reasonCode: result.reasonCode }
        });
        return;
      }

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

      // 3b. Reputación externa: se consultan el enlace original y el destino final.
      // Si la fuente lo tiene listado, el veredicto pasa a peligroso aunque la página
      // no haya mostrado señales en el sandbox. Si la fuente falla, se conserva el veredicto.
      if (this.reputationService) {
        const reputation = await this.reputationService.check([job.targetUrl, result.finalDestination]);
        if (reputation.status === 'unavailable') {
          analysis.sourceFailures = [reputation.failure];
        } else {
          analysis.sourceResults = [...analysis.sourceResults, reputation.sourceResult].slice(-4);
          if (reputation.status === 'listed') {
            analysis.verdict = 'peligroso';
            analysis.reasons = [
              reputation.sourceResult.summary ?? 'Una fuente de reputación externa tiene este enlace registrado como amenaza.',
              ...analysis.reasons.filter((r) => !r.includes('no constituye garantía'))
            ].slice(0, 10);
            if (!analysis.signals.includes('reputation_listed')) {
              analysis.signals = [...analysis.signals, 'reputation_listed'].slice(0, 50);
            }
          }
        }
      }

      const now = new Date();

      // 4. Update attempt with terminal completed status and analytical result
      const completed = await this.dailyAnalysisRepository.completeClaimedAnalysisJob(job, now, analysis);
      if (!completed) return;

      // 5. Record audit event
      await this.securityAuditRepository.record({
        occurredAt: now,
        purgeAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
        eventType: 'analysis.completed',
        actorType: 'user',
        actorId: job.userId,
        action: 'process_analysis',
        outcome: 'success',
        resourceType: 'attempt',
        resourceId: job.attemptId,
        metadata: {
          analysisStatus: 'completed'
        }
      });
    } catch (err: unknown) {
      const now = new Date();

      const reasonCode = err instanceof SandboxServiceError ? err.reasonCode : 'sandbox_processing_failed';
      if (err instanceof SandboxServiceError && err.retryable && job.attemptNumber < this.maxAttempts) {
        const backoffMs = Math.min(60_000, 1_000 * (2 ** Math.max(0, job.attemptNumber - 1)));
        const retry = await this.dailyAnalysisRepository.retryClaimedAnalysisJob(
          job,
          now,
          new Date(now.getTime() + backoffMs),
          reasonCode,
          this.maxAttempts
        );
        if (retry === 'rescheduled' || retry === 'stale') return;
      }

      // Terminal failures are committed only by the worker holding the current fencing token.
      const failed = await this.dailyAnalysisRepository.failClaimedAnalysisJob(job, now, 'failed', reasonCode);
      if (!failed) return;

      await this.securityAuditRepository.record({
        occurredAt: now,
        purgeAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
        eventType: 'analysis.failed',
        actorType: 'user',
        actorId: job.userId,
        action: 'process_analysis',
        outcome: 'failure',
        resourceType: 'attempt',
        resourceId: job.attemptId,
        metadata: {
          analysisStatus: 'failed',
          reasonCode
        }
      });
    }
  }
}
