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
});
