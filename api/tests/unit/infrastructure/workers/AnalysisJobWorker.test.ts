import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IDailyAnalysisRepository, AnalysisQueueSnapshot, ClaimedAnalysisJob } from '../../../../src/core/ports/IDailyAnalysisRepository.js';
import type { ProcessAnalysisJobUseCase } from '../../../../src/use-cases/analysis/ProcessAnalysisJobUseCase.js';
import { AnalysisJobWorker } from '../../../../src/infrastructure/workers/AnalysisJobWorker.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

const job: ClaimedAnalysisJob = {
  userId: 'user-test',
  localDate: '2026-11-04',
  attemptId: 'attempt-test',
  leaseToken: 'lease-test',
  attemptNumber: 1,
  targetUrl: 'https://example.test/'
};

function createWorker(options: {
  shutdownGraceMs: number;
  execute: () => Promise<void>;
  claim?: () => Promise<ClaimedAnalysisJob | null>;
  onError?: (message: string) => void;
  snapshot?: () => Promise<AnalysisQueueSnapshot>;
  onSnapshot?: (snapshot: AnalysisQueueSnapshot & { inFlightCount: number; concurrency: number; pollFailureCount: number }) => void;
}) {
  let claimCalls = 0;
  const repository = {
    async claimNextAnalysisJob() {
      claimCalls += 1;
      return options.claim ? options.claim() : claimCalls === 1 ? job : null;
    },
    ...(options.snapshot ? { getAnalysisQueueSnapshot: options.snapshot } : {})
  } as unknown as IDailyAnalysisRepository;
  const processor = { execute: options.execute } as unknown as ProcessAnalysisJobUseCase;
  const worker = new AnalysisJobWorker(repository, processor, {
    concurrency: 1,
    pollIntervalMs: 100,
    leaseDurationMs: 60_000,
    shutdownGraceMs: options.shutdownGraceMs,
    onError: options.onError,
    ...(options.onSnapshot ? { onSnapshot: options.onSnapshot, snapshotIntervalMs: 10_000 } : {})
  });
  return { worker, getClaimCalls: () => claimCalls };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail('Condition was not reached before test timeout.');
}

describe('AnalysisJobWorker shutdown drain', () => {
  it('rejects a shutdown grace that can overlap the lease', () => {
    assert.throws(() => createWorker({
      shutdownGraceMs: 60_000,
      execute: async () => undefined
    }), /positive integer shorter than the job lease/);
  });

  it('stops new claims and waits for active work to settle', async () => {
    const started = deferred<void>();
    const finish = deferred<void>();
    const { worker, getClaimCalls } = createWorker({
      shutdownGraceMs: 100,
      execute: () => { started.resolve(); return finish.promise; }
    });
    worker.start();
    await started.promise;

    const stop = worker.stop();
    finish.resolve();
    const result = await stop;

    assert.deepEqual(result, { status: 'drained', remainingJobs: 0 });
    assert.equal(getClaimCalls(), 1, 'worker must not claim more work after stop begins');
  });

  it('keeps a job claimed by an in-progress poll tracked during shutdown', async () => {
    const claimStarted = deferred<void>();
    const releaseClaim = deferred<ClaimedAnalysisJob | null>();
    const executeStarted = deferred<void>();
    const finish = deferred<void>();
    const { worker } = createWorker({
      shutdownGraceMs: 100,
      claim: () => { claimStarted.resolve(); return releaseClaim.promise; },
      execute: () => { executeStarted.resolve(); return finish.promise; }
    });
    worker.start();
    await claimStarted.promise;

    const stop = worker.stop();
    releaseClaim.resolve(job);
    await executeStarted.promise;
    finish.resolve();

    assert.deepEqual(await stop, { status: 'drained', remainingJobs: 0 });
  });

  it('returns a timed-out drain result and leaves active jobs recoverable by lease expiry', async () => {
    const started = deferred<void>();
    const finish = deferred<void>();
    const errors: string[] = [];
    const { worker } = createWorker({
      shutdownGraceMs: 20,
      execute: () => { started.resolve(); return finish.promise; },
      onError: (message) => errors.push(message)
    });
    worker.start();
    await started.promise;

    assert.deepEqual(await worker.stop(), { status: 'timed_out', remainingJobs: 1 });
    assert.deepEqual(errors, ['Analysis worker shutdown drain timed out; unfinished jobs remain recoverable through their leases.']);
    finish.resolve();
  });

  it('emits a low-cardinality queue snapshot without blocking processing', async () => {
    const started = deferred<void>();
    const finish = deferred<void>();
    const expected: AnalysisQueueSnapshot = {
      pendingCount: 2,
      maxPending: 100,
      queuedCount: 1,
      leasedCount: 1,
      expiredLeaseCount: 0,
      retryingCount: 1,
      deadCount: 3,
      oldestPendingAgeMs: 12_000
    };
    const snapshots: Array<AnalysisQueueSnapshot & { inFlightCount: number; concurrency: number; pollFailureCount: number }> = [];
    const { worker } = createWorker({
      shutdownGraceMs: 100,
      execute: () => { started.resolve(); return finish.promise; },
      snapshot: async () => expected,
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    });
    worker.start();
    await started.promise;
    await waitUntil(() => snapshots.length === 1);
    finish.resolve();
    assert.deepEqual(await worker.stop(), { status: 'drained', remainingJobs: 0 });
    assert.deepEqual(snapshots[0], { ...expected, inFlightCount: 1, concurrency: 1, pollFailureCount: 0 });
  });
});
