import { ClaimedAnalysisJob, IDailyAnalysisRepository } from '../../core/ports/IDailyAnalysisRepository.js';
import { ISecurityAuditRepository } from '../../core/ports/ISecurityAuditRepository.js';
import { ISandboxService } from '../../core/ports/ISandboxService.js';
import { AnalysisPayload } from '../../core/entities/Analysis.js';
import { SandboxServiceError } from '../../core/errors/DomainErrors.js';
import type { IReputationProvider, ReputationResult } from '../../core/ports/IReputationProvider.js';

export class ProcessAnalysisJobUseCase {
  constructor(
    private readonly dailyAnalysisRepository: IDailyAnalysisRepository,
    private readonly securityAuditRepository: ISecurityAuditRepository,
    private readonly sandboxService: ISandboxService,
    private readonly maxAttempts = 4,
    private readonly reputation?: IReputationProvider
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

      let reputation: ReputationResult = { status: 'not_queried' };
      if (this.reputation) {
        try { reputation = await this.reputation.check(job.targetUrl); }
        catch { reputation = { status: 'error' }; }
      }
      if (result.sourceResults.length > 3) throw new Error('Sandbox source capacity exceeded.');
      const hasReport = reputation.status === 'match' || reputation.status === 'no_match';
      const verdict = reputation.status === 'match' && result.verdict === 'sin_amenazas_detectadas'
        ? 'sospechoso' : result.verdict;
      // El sandbox tiene prioridad: es el que abrió e interactuó con la página. Si encontró peligro y
      // los antivirus no, se explica que el sitio puede ser nuevo o estar bien disfrazado.
      const sandboxFoundRisk = result.verdict === 'peligroso' || result.verdict === 'sospechoso';
      const reasons = reputation.status === 'match'
        ? [`VirusTotal reportó ${reputation.malicious} detección(es) maliciosa(s); el resultado requiere revisión.`, ...result.reasons].slice(0, 10)
        : sandboxFoundRisk && (reputation.status === 'no_match' || reputation.status === 'not_found')
          ? [...result.reasons.slice(0, 9), 'Los antivirus de VirusTotal todavía no reportan este enlace, pero el entorno aislado sí encontró riesgo: puede ser un sitio nuevo o bien disfrazado.']
          : result.reasons.slice(0, 10);

      // 3. Format structured AnalysisPayload
      const analysis: AnalysisPayload = {
        verdict,
        reasons,
        finalDestination: result.finalDestination.slice(0, 8192),
        sourceResults: (reputation.status === 'match' || reputation.status === 'no_match') ? [...result.sourceResults, {
          sourceName: 'VirusTotal', status: reputation.status, checkedAt: reputation.checkedAt,
          expiresAt: new Date(reputation.checkedAt.getTime() + 24 * 60 * 60 * 1000), resultCode: reputation.status,
          summary: reputation.scope === 'domain'
            ? `Informe del dominio ${reputation.domain ?? ''} del ${reputation.reportAt.toISOString()}; detecciones maliciosas: ${reputation.malicious}.`
            : `Informe del ${reputation.reportAt.toISOString()}; detecciones maliciosas: ${reputation.malicious}.`
        }] : result.sourceResults,
        sourceFailures: hasReport ? [] : [{ sourceName: 'VirusTotal', reasonCode: reputation.status }],
        signals: result.signals.slice(0, 50),
        redirects: result.redirects.slice(0, 10),
        screenshotRef: result.screenshotRef
      };

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
