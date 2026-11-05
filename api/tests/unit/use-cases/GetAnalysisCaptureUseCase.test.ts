import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GetAnalysisCaptureUseCase } from '../../../src/use-cases/analysis/GetAnalysisCaptureUseCase.js';
import { CaptureUnavailableError, ResourceNotFoundError, SandboxServiceError } from '../../../src/core/errors/DomainErrors.js';

describe('GetAnalysisCaptureUseCase', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const bytes = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);

  it('requires owner, completed analysis, and stored capture reference before proxying', async () => {
    let proxyCalls = 0;
    const repository = {
      findAttemptGlobally: async () => ({
        dailyAnalysis: { userId: 'owner-1' },
        attempt: { attemptId: id, processingStatus: 'completed', analysis: { screenshotRef: 'local://private/path' } }
      })
    };
    const sandbox = { getCapture: async () => { proxyCalls += 1; return bytes; } };
    const useCase = new GetAnalysisCaptureUseCase(repository as never, sandbox as never);
    assert.deepEqual(await useCase.execute('owner-1', id), bytes);
    await assert.rejects(useCase.execute('other-user', id), ResourceNotFoundError);
    assert.equal(proxyCalls, 1);
  });

  it('does not proxy when the analysis is absent or has no completed capture', async () => {
    let proxyCalls = 0;
    const repository = { findAttemptGlobally: async () => null };
    const sandbox = { getCapture: async () => { proxyCalls += 1; return bytes; } };
    const useCase = new GetAnalysisCaptureUseCase(repository as never, sandbox as never);
    await assert.rejects(useCase.execute('owner-1', id), ResourceNotFoundError);
    assert.equal(proxyCalls, 0);
  });

  it('turns private transport errors into generic 503 errors', async () => {
    const repository = { findAttemptGlobally: async () => ({ dailyAnalysis: { userId: 'owner-1' },
      attempt: { processingStatus: 'completed', analysis: { screenshotRef: 'local://secret' } } }) };
    const sandbox = { getCapture: async () => { throw new SandboxServiceError('sandbox_capture_http_500', true); } };
    const useCase = new GetAnalysisCaptureUseCase(repository as never, sandbox as never);
    await assert.rejects(useCase.execute('owner-1', id), CaptureUnavailableError);
  });
});
