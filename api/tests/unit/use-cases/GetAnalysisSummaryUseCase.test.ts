import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GetAnalysisSummaryUseCase } from '../../../src/use-cases/analysis/GetAnalysisSummaryUseCase.js';
import { MockDailyAnalysisRepository } from '../../mocks/MockRepositories.js';

describe('GetAnalysisSummaryUseCase', () => {
  it('uses an exact rolling 365×24-hour window and returns count-only metrics', async () => {
    const repository = new MockDailyAnalysisRepository();
    let query: unknown;
    repository.getUserAnalysisSummary = async (userId, start, end) => {
      query = { userId, start, end };
      return { total: 7, dangerous: 2, suspicious: 1 };
    };
    const now = new Date('2026-11-04T12:00:00.000Z');
    const useCase = new GetAnalysisSummaryUseCase(repository, () => now);

    const result = await useCase.execute('owner-id');

    assert.deepEqual(query, {
      userId: 'owner-id',
      start: new Date('2025-11-04T12:00:00.000Z'),
      end: now
    });
    assert.deepEqual(result, {
      window: { startsAtInclusive: '2025-11-04T12:00:00.000Z', endsAtExclusive: '2026-11-04T12:00:00.000Z' },
      total: 7,
      dangerous: 2,
      suspicious: 1
    });
  });
});
