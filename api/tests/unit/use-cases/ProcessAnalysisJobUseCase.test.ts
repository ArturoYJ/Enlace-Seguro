import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessAnalysisJobUseCase } from '../../../src/use-cases/analysis/ProcessAnalysisJobUseCase.js';
import { SandboxServiceError } from '../../../src/core/errors/DomainErrors.js';
import { MockDailyAnalysisRepository, MockSecurityAuditRepository } from '../../mocks/MockRepositories.js';

const attempt = (attemptId: string) => ({
  attemptId,
  receivedAt: new Date(),
  updatedAt: new Date(),
  processingStatus: 'received' as const,
  inputDigest: 'a'.repeat(64),
  inputSizeBytes: 32,
  submittedInput: 'https://private.example/reset?token=secret'
});

describe('ProcessAnalysisJobUseCase', () => {
  it('records only stable error codes after a terminal failure', async () => {
    const dailyRepository = new MockDailyAnalysisRepository();
    const auditRepository = new MockSecurityAuditRepository();
    const sandbox = {
      analyze: async () => { throw new Error('Navigation failed for https://private.example/reset?token=secret'); },
      isHealthy: async () => true
    };
    await dailyRepository.admitAttemptAtomic('user-1', '2026-11-03', attempt('attempt-1'));
    const claimed = await dailyRepository.claimNextAnalysisJob('unit-worker', new Date(), 60_000);
    assert.ok(claimed);

    await new ProcessAnalysisJobUseCase(dailyRepository, auditRepository, sandbox).execute(claimed);
    const failureEvent = auditRepository.events.find((event) => event.eventType === 'analysis.failed');
    assert.ok(failureEvent);
    assert.equal(failureEvent.metadata?.['reasonCode'], 'sandbox_processing_failed');
    assert.doesNotMatch(JSON.stringify(failureEvent.metadata), /private\.example|secret|Navigation failed/);
    assert.equal((await dailyRepository.findAttemptByLocalKey('user-1', '2026-11-03', 'attempt-1'))?.attempt.processingStatus, 'failed');
  });

  it('reschedules the Sandbox global-deadline 504 without terminal audit or losing the admitted job', async () => {
    const dailyRepository = new MockDailyAnalysisRepository();
    const auditRepository = new MockSecurityAuditRepository();
    const sandbox = {
      analyze: async () => { throw new SandboxServiceError('sandbox_http_504', true); },
      isHealthy: async () => true
    };
    await dailyRepository.admitAttemptAtomic('user-1', '2026-11-03', attempt('attempt-2'));
    const claimed = await dailyRepository.claimNextAnalysisJob('unit-worker', new Date(), 60_000);
    assert.ok(claimed);

    await new ProcessAnalysisJobUseCase(dailyRepository, auditRepository, sandbox).execute(claimed);
    assert.equal(auditRepository.events.length, 0);
    assert.equal((await dailyRepository.findAttemptByLocalKey('user-1', '2026-11-03', 'attempt-2'))?.attempt.processingStatus, 'processing');
    const immediatelyAvailable = await dailyRepository.claimNextAnalysisJob('second-worker', new Date(), 60_000);
    assert.equal(immediatelyAvailable, null, 'exponential backoff prevents immediate redelivery');
  });

  it('audits jobs terminalized after repeated worker crashes without calling the Sandbox', async () => {
    const dailyRepository = new MockDailyAnalysisRepository();
    const auditRepository = new MockSecurityAuditRepository();
    let sandboxCalls = 0;
    const sandbox = {
      analyze: async () => { sandboxCalls += 1; throw new Error('must not run'); },
      isHealthy: async () => true
    };
    await new ProcessAnalysisJobUseCase(dailyRepository, auditRepository, sandbox).execute({
      userId: 'user-1', localDate: '2026-11-03', attemptId: 'attempt-exhausted', leaseToken: 'not-persisted',
      attemptNumber: 4, targetUrl: 'https://example.test/', leaseExhausted: true
    });
    assert.equal(sandboxCalls, 0);
    assert.equal(auditRepository.events[0]?.metadata?.['reasonCode'], 'worker_lease_exhausted');
  });

  it('does not commit a result after the lease fencing token is stale', async () => {
    const dailyRepository = new MockDailyAnalysisRepository();
    const auditRepository = new MockSecurityAuditRepository();
    let sandboxCalls = 0;
    const sandbox = {
      analyze: async (attemptId: string) => {
        sandboxCalls += 1;
        return {
          outcome: 'completed',
          attemptId,
          targetUrl: 'https://example.test/',
          finalDestination: 'https://example.test/',
          redirects: [], signals: [], verdict: 'sin_amenazas_detectadas' as const, reasons: [], sourceResults: []
        };
      },
      isHealthy: async () => true
    };
    await dailyRepository.admitAttemptAtomic('user-1', '2026-11-03', attempt('attempt-3'));
    const stale = await dailyRepository.claimNextAnalysisJob('first-worker', new Date(), 1_000);
    assert.ok(stale);
    const recovered = await dailyRepository.claimNextAnalysisJob('second-worker', new Date(Date.now() + 2_000), 60_000);
    assert.ok(recovered);
    assert.notEqual(stale.leaseToken, recovered.leaseToken);

    await new ProcessAnalysisJobUseCase(dailyRepository, auditRepository, sandbox).execute(stale);
    assert.equal(sandboxCalls, 1);
    assert.equal(auditRepository.events.length, 0, 'stale worker cannot emit terminal audit');
    assert.equal((await dailyRepository.findAttemptByLocalKey('user-1', '2026-11-03', 'attempt-3'))?.attempt.processingStatus, 'processing');
  });

  it('persists invalid main-document TLS as inconclusive without a verdict or retry', async () => {
    const dailyRepository = new MockDailyAnalysisRepository();
    const auditRepository = new MockSecurityAuditRepository();
    const sandbox = {
      analyze: async (attemptId: string) => ({
        outcome: 'inconclusive' as const,
        reasonCode: 'tls_certificate_invalid' as const,
        attemptId,
        targetUrl: 'https://example.test/',
        finalDestination: 'https://example.test/',
        redirects: [], signals: ['tls_certificate_validation_failed'], sourceResults: []
      }),
      isHealthy: async () => true
    };
    await dailyRepository.admitAttemptAtomic('user-1', '2026-11-03', attempt('attempt-tls'));
    const claimed = await dailyRepository.claimNextAnalysisJob('unit-worker', new Date(), 60_000);
    assert.ok(claimed);

    await new ProcessAnalysisJobUseCase(dailyRepository, auditRepository, sandbox).execute(claimed);
    const persisted = await dailyRepository.findAttemptByLocalKey('user-1', '2026-11-03', 'attempt-tls');
    assert.equal(persisted?.attempt.processingStatus, 'inconclusive');
    assert.equal(persisted?.attempt.analysis, undefined, 'inconclusive results must not carry a verdict payload');
    assert.equal(auditRepository.events[0]?.eventType, 'analysis.inconclusive');
    assert.equal(auditRepository.events[0]?.outcome, 'partial');
    assert.equal(auditRepository.events[0]?.metadata?.['reasonCode'], 'tls_certificate_invalid');
  });
});
