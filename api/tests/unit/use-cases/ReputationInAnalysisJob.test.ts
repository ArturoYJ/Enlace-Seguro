import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessAnalysisJobUseCase } from '../../../src/use-cases/analysis/ProcessAnalysisJobUseCase.js';
import { IReputationService, ReputationCheck } from '../../../src/core/ports/IReputationService.js';
import { MockDailyAnalysisRepository, MockSecurityAuditRepository } from '../../mocks/MockRepositories.js';

const attempt = (attemptId: string) => ({
  attemptId,
  receivedAt: new Date(),
  updatedAt: new Date(),
  processingStatus: 'received' as const,
  inputDigest: 'a'.repeat(64),
  inputSizeBytes: 32,
  submittedInput: 'https://phish.example/login'
});

const cleanSandbox = {
  analyze: async (attemptId: string) => ({
    outcome: 'completed' as const,
    attemptId,
    targetUrl: 'https://phish.example/login',
    finalDestination: 'https://phish.example/final',
    redirects: [],
    signals: [],
    verdict: 'sin_amenazas_detectadas' as const,
    reasons: ['Carga completada en entorno aislado sin señales de riesgo detectadas. Este análisis es preventivo y no constituye garantía de seguridad absoluta.'],
    sourceResults: []
  }),
  getCapture: async () => null,
  isHealthy: async () => true
};

class FakeReputation implements IReputationService {
  public calls: string[][] = [];
  constructor(private readonly response: ReputationCheck) {}
  async check(urls: string[]): Promise<ReputationCheck> {
    this.calls.push(urls);
    return this.response;
  }
}

async function run(reputation?: IReputationService) {
  const dailyRepository = new MockDailyAnalysisRepository();
  const auditRepository = new MockSecurityAuditRepository();
  await dailyRepository.admitAttemptAtomic('user-1', '2026-11-21', attempt('attempt-r'));
  const claimed = await dailyRepository.claimNextAnalysisJob('unit-worker', new Date(), 60_000);
  assert.ok(claimed);
  await new ProcessAnalysisJobUseCase(dailyRepository, auditRepository, cleanSandbox, 4, reputation).execute(claimed);
  const stored = await dailyRepository.findAttemptByLocalKey('user-1', '2026-11-21', 'attempt-r');
  return stored?.attempt;
}

describe('ProcessAnalysisJobUseCase con reputación externa', () => {
  it('cambia a peligroso cuando Google Safe Browsing tiene listado el enlace', async () => {
    const now = new Date();
    const reputation = new FakeReputation({
      status: 'listed',
      threatTypes: ['SOCIAL_ENGINEERING'],
      sourceResult: {
        sourceName: 'google_safe_browsing', status: 'listed', checkedAt: now, expiresAt: new Date(now.getTime() + 300_000),
        resultCode: 'SOCIAL_ENGINEERING', summary: 'Listado por Google Safe Browsing como phishing o engaño.'
      }
    });

    const stored = await run(reputation);
    assert.equal(stored?.processingStatus, 'completed');
    assert.equal(stored?.analysis?.verdict, 'peligroso');
    assert.equal(stored?.analysis?.reasons[0], 'Listado por Google Safe Browsing como phishing o engaño.');
    assert.ok(!stored?.analysis?.reasons.some((r) => r.includes('no constituye garantía')), 'no debe quedar el texto de "sin amenazas"');
    assert.ok(stored?.analysis?.signals.includes('reputation_listed'));
    assert.equal(stored?.analysis?.sourceResults[0]?.sourceName, 'google_safe_browsing');
    assert.deepEqual(reputation.calls[0], ['https://phish.example/login', 'https://phish.example/final']);
  });

  it('conserva el veredicto del sandbox cuando la fuente no lo tiene listado', async () => {
    const now = new Date();
    const stored = await run(new FakeReputation({
      status: 'clean',
      sourceResult: { sourceName: 'google_safe_browsing', status: 'clean', checkedAt: now, expiresAt: now }
    }));
    assert.equal(stored?.analysis?.verdict, 'sin_amenazas_detectadas');
    assert.equal(stored?.analysis?.sourceResults[0]?.status, 'clean');
    assert.deepEqual(stored?.analysis?.sourceFailures, []);
  });

  it('si la fuente falla registra el fallo y no detiene el análisis', async () => {
    const stored = await run(new FakeReputation({ status: 'unavailable', failure: { sourceName: 'google_safe_browsing', reasonCode: 'timeout' } }));
    assert.equal(stored?.processingStatus, 'completed');
    assert.equal(stored?.analysis?.verdict, 'sin_amenazas_detectadas');
    assert.deepEqual(stored?.analysis?.sourceFailures, [{ sourceName: 'google_safe_browsing', reasonCode: 'timeout' }]);
  });

  it('sin clave configurada funciona igual que antes', async () => {
    const stored = await run(undefined);
    assert.equal(stored?.analysis?.verdict, 'sin_amenazas_detectadas');
    assert.deepEqual(stored?.analysis?.sourceResults, []);
  });
});
