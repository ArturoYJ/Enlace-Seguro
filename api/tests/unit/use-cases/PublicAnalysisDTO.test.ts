import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GetAnalysisDetailUseCase } from '../../../src/use-cases/analysis/GetAnalysisDetailUseCase.js';
import { ListAnalysesUseCase } from '../../../src/use-cases/analysis/ListAnalysesUseCase.js';

describe('public analysis DTOs', () => {
  it('does not expose internal screenshot references in detail or list responses', async () => {
    const attempt = {
      attemptId: '123e4567-e89b-42d3-a456-426614174000', receivedAt: new Date(), updatedAt: new Date(),
      processingStatus: 'completed' as const, inputDigest: 'a'.repeat(64), inputSizeBytes: 20,
      analysis: { verdict: 'sospechoso' as const, reasons: [], finalDestination: 'https://example.test/',
        sourceResults: [], sourceFailures: [], signals: [], redirects: [], screenshotRef: 'local:///private/store/secret.webp' }
    };
    const repository = {
      findAttemptGlobally: async () => ({ dailyAnalysis: { userId: 'owner', localDate: '2026-11-03' }, attempt }),
      listUserAttempts: async () => ({ items: [{ ...attempt, localDate: '2026-11-03' }], hasMore: false, nextCursor: null })
    };
    const detail = await new GetAnalysisDetailUseCase(repository as never).execute({
      attemptId: attempt.attemptId, requestingUser: { userId: 'owner', role: 'usuario' }
    });
    const list = await new ListAnalysesUseCase(repository as never).execute({ userId: 'owner' });
    assert.ok(detail.analysis);
    assert.ok(list.items[0]?.analysis);
    assert.equal('screenshotRef' in detail.analysis!, false);
    assert.equal('screenshotRef' in list.items[0]!.analysis!, false);
  });

  it('explica por qué falló un análisis con una categoría pública, sin el código interno', async () => {
    const base = { receivedAt: new Date(), updatedAt: new Date(), inputDigest: 'a'.repeat(64), inputSizeBytes: 20 };
    const cases = [
      ['sandbox_http_502', 'failed', 'site_unreachable'], ['sandbox_timeout', 'failed', 'site_too_slow'],
      ['dns_unavailable', 'inconclusive', 'dns_unavailable'], ['tls_certificate_invalid', 'inconclusive', 'tls_invalid'],
      ['sandbox_http_503', 'failed', 'service_busy'], ['worker_lease_exhausted', 'failed', 'service_error']
    ] as const;
    for (const [code, status, expected] of cases) {
      const attempt = { ...base, attemptId: '123e4567-e89b-42d3-a456-426614174001', processingStatus: status, failureCode: code };
      const repository = {
        findAttemptGlobally: async () => ({ dailyAnalysis: { userId: 'owner', localDate: '2026-11-03' }, attempt }),
        listUserAttempts: async () => ({ items: [{ ...attempt, localDate: '2026-11-03' }], hasMore: false, nextCursor: null })
      };
      const detail = await new GetAnalysisDetailUseCase(repository as never).execute({
        attemptId: attempt.attemptId, requestingUser: { userId: 'owner', role: 'usuario' }
      });
      const list = await new ListAnalysesUseCase(repository as never).execute({ userId: 'owner' });
      assert.equal(detail.failureReason, expected);
      assert.equal((list.items[0] as { failureReason?: string }).failureReason, expected);
      if (code === expected) continue;
      assert.equal(JSON.stringify(detail).includes(code), false, code);
      assert.equal(JSON.stringify(list).includes(code), false, code);
    }
  });

  it('no agrega razón de fallo a un análisis completado', async () => {
    const attempt = { attemptId: '123e4567-e89b-42d3-a456-426614174002', receivedAt: new Date(), updatedAt: new Date(),
      processingStatus: 'completed' as const, inputDigest: 'a'.repeat(64), inputSizeBytes: 20 };
    const repository = { findAttemptGlobally: async () => ({ dailyAnalysis: { userId: 'owner', localDate: '2026-11-03' }, attempt }) };
    const detail = await new GetAnalysisDetailUseCase(repository as never).execute({
      attemptId: attempt.attemptId, requestingUser: { userId: 'owner', role: 'usuario' }
    });
    assert.equal('failureReason' in detail, false);
  });
});
