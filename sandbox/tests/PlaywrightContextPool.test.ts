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
  it('counts only main-frame navigation redirects and retains repeated locations', async () => {
    const original = AntiSsrfGuard.validateDestination;
    AntiSsrfGuard.validateDestination = async () => ({ safe: true });
    const pool = new PlaywrightContextPool({} as IScreenshotStorage);
    const mainFrame = {};
    let responseHandler: (response: unknown) => void = () => undefined;
    const response = (navigation: boolean, frame: unknown, location: string) => ({
      status: () => 302, headers: () => ({ location }),
      request: () => ({ isNavigationRequest: () => navigation, frame: () => frame })
    });
    const page = { on: (event: string, callback: (response: unknown) => void) => { if (event === 'response') responseHandler = callback; },
      mainFrame: () => mainFrame,
      goto: async () => { responseHandler(response(false, mainFrame, '/asset'));
        responseHandler(response(true, {}, '/iframe')); responseHandler(response(true, mainFrame, '/next'));
        responseHandler(response(true, mainFrame, '/next')); },
      url: () => 'https://example.test/next', evaluate: async () => [], screenshot: async () => { throw new Error('unavailable'); } };
    const context = { route: async () => undefined, routeWebSocket: async () => undefined, newPage: async () => page, close: async () => undefined };
    const internal = pool as unknown as { browser: unknown; init: () => Promise<void> };
    internal.browser = { newContext: async () => context };
    internal.init = async () => undefined;
    try {
      const output = await pool.analyzeUrl('55555555-5555-4555-8555-555555555555', 'https://example.test');
      assert.deepEqual(output.redirects, ['/next', '/next']);
      assert.equal(output.outcome, 'completed');
    } finally { AntiSsrfGuard.validateDestination = original; }
  });
  it('does not issue a clean verdict or save a capture when DOM inspection fails', async () => {
    const original = AntiSsrfGuard.validateDestination;
    AntiSsrfGuard.validateDestination = async () => ({ safe: true });
    let captures = 0;
    const pool = new PlaywrightContextPool({ saveScreenshot: async () => { captures++; return 'capture'; } } as unknown as IScreenshotStorage);
    const page = { on: () => undefined, goto: async () => undefined, url: () => 'https://example.test',
      evaluate: async () => { throw new Error('closed'); }, screenshot: async () => Buffer.from('x') };
    const context = { route: async () => undefined, routeWebSocket: async () => undefined,
      newPage: async () => page, close: async () => undefined };
    const internal = pool as unknown as { browser: unknown; init: () => Promise<void> };
    internal.browser = { newContext: async () => context };
    internal.init = async () => undefined;
    try {
      const output = await pool.analyzeUrl('44444444-4444-4444-8444-444444444444', 'https://example.test');
      assert.equal(output.outcome, 'inconclusive');
      if (output.outcome === 'inconclusive') assert.equal(output.reasonCode, 'dom_inspection_failed');
      assert.equal('verdict' in output, false);
      assert.equal(captures, 0);
    } finally { AntiSsrfGuard.validateDestination = original; }
  });
  it('returns inconclusive for DNS failure without opening a browser or reporting danger', async () => {
    const original = AntiSsrfGuard.validateDestination;
    AntiSsrfGuard.validateDestination = async () => ({ safe: false, reasonCode: 'dns_unavailable' });
    try {
      const pool = new PlaywrightContextPool({} as IScreenshotStorage);
      const output = await pool.analyzeUrl('33333333-3333-4333-8333-333333333333', 'https://example.test');
      assert.equal(output.outcome, 'inconclusive');
      if (output.outcome === 'inconclusive') assert.equal(output.reasonCode, 'dns_unavailable');
      assert.equal('verdict' in output, false);
      assert.equal('screenshotRef' in output, false);
    } finally { AntiSsrfGuard.validateDestination = original; }
  });
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
