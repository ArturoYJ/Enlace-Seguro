import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AntiSsrfGuard } from '../src/core/AntiSsrfGuard.js';
import { PlaywrightContextPool, SandboxAnalysisTimeoutError, SandboxCapacityError, SandboxExecutionResult } from '../src/infrastructure/PlaywrightContextPool.js';
import { IScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';

const result = (attemptId: string, targetUrl: string): SandboxExecutionResult => ({
  outcome: 'completed', attemptId, targetUrl, finalDestination: targetUrl, redirects: [], signals: [],
  verdict: 'sin_amenazas_detectadas', reasons: [], sourceResults: []
});

describe('PlaywrightContextPool job safeguards', () => {
  it('deduplicates active/completed calls by attemptId and rejects a changed payload', async () => {
    const storage = {} as IScreenshotStorage;
    const pool = new PlaywrightContextPool(storage, 1, undefined, 1);
    let runs = 0;
    let finish!: (value: SandboxExecutionResult) => void;
    const internal = pool as unknown as { runAnalysis(id: string, url: string): Promise<SandboxExecutionResult> };
    internal.runAnalysis = async (id, url) => {
      runs += 1;
      return new Promise((resolve) => { finish = resolve; }).then(() => result(id, url));
    };

    const first = pool.analyzeUrl('11111111-1111-4111-8111-111111111111', 'https://example.test');
    const duplicate = pool.analyzeUrl('11111111-1111-4111-8111-111111111111', 'https://example.test');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runs, 1);
    finish(result('11111111-1111-4111-8111-111111111111', 'https://example.test'));
    assert.deepEqual(await first, await duplicate);
    assert.deepEqual(
      await pool.analyzeUrl('11111111-1111-4111-8111-111111111111', 'https://example.test'),
      result('11111111-1111-4111-8111-111111111111', 'https://example.test')
    );
    await assert.rejects(
      pool.analyzeUrl('11111111-1111-4111-8111-111111111111', 'https://changed.test'),
      /Idempotency conflict/
    );
    assert.equal(runs, 1);
  });

  it('bounds the browser wait queue and releases slots FIFO', async () => {
    const pool = new PlaywrightContextPool({} as IScreenshotStorage, 1, undefined, 1);
    const internal = pool as unknown as { acquireSlot(signal: AbortSignal): Promise<void>; releaseSlot(): void };
    await internal.acquireSlot(new AbortController().signal);
    let secondAcquired = false;
    const second = internal.acquireSlot(new AbortController().signal).then(() => { secondAcquired = true; });
    await assert.rejects(internal.acquireSlot(new AbortController().signal), SandboxCapacityError);
    internal.releaseSlot();
    await second;
    assert.equal(secondAcquired, true);
    internal.releaseSlot();
  });

  it('removes a timed-out waiter from the semaphore queue without releasing another job slot', async () => {
    const pool = new PlaywrightContextPool({} as IScreenshotStorage, 1, undefined, 1, 500);
    const internal = pool as unknown as {
      acquireSlot(signal: AbortSignal): Promise<void>;
      releaseSlot(): void;
      activeJobs: number;
      queuedJobs: unknown[];
    };
    await internal.acquireSlot(new AbortController().signal);
    const controller = new AbortController();
    const waiting = internal.acquireSlot(controller.signal);
    assert.equal(internal.queuedJobs.length, 1);
    controller.abort(new SandboxAnalysisTimeoutError());
    await assert.rejects(waiting, SandboxAnalysisTimeoutError);
    assert.equal(internal.queuedJobs.length, 0);
    assert.equal(internal.activeJobs, 1);
    internal.releaseSlot();
    assert.equal(internal.activeJobs, 0);
  });

  it('bounds the entire job while DNS preflight is pending and evicts the expired idempotency key', async () => {
    const originalValidateDestination = AntiSsrfGuard.validateDestination;
    AntiSsrfGuard.validateDestination = async () => new Promise(() => undefined);
    const pool = new PlaywrightContextPool({} as IScreenshotStorage, 1, undefined, 1, 20);
    try {
      await assert.rejects(
        pool.analyzeUrl('22222222-2222-4222-8222-222222222222', 'https://example.test'),
        SandboxAnalysisTimeoutError
      );
      const internal = pool as unknown as { idempotentJobs: Map<string, unknown>; activeJobs: number };
      assert.equal(internal.idempotentJobs.size, 0);
      assert.equal(internal.activeJobs, 0);
    } finally {
      AntiSsrfGuard.validateDestination = originalValidateDestination;
    }
  });
});
