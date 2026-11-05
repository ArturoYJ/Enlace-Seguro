import { randomUUID } from 'node:crypto';
import { AnalysisQueueSnapshot, IDailyAnalysisRepository } from '../../core/ports/IDailyAnalysisRepository.js';
import { ProcessAnalysisJobUseCase } from '../../use-cases/analysis/ProcessAnalysisJobUseCase.js';

export interface AnalysisJobWorkerOptions {
  concurrency: number;
  pollIntervalMs: number;
  leaseDurationMs: number;
  shutdownGraceMs?: number;
  maxAttempts?: number;
  snapshotIntervalMs?: number;
  onError?: (message: string) => void;
  onSnapshot?: (snapshot: AnalysisQueueSnapshot & {
    inFlightCount: number;
    concurrency: number;
    pollFailureCount: number;
  }) => void;
}

export type AnalysisJobWorkerStopResult =
  | { status: 'drained'; remainingJobs: 0 }
  | { status: 'timed_out'; remainingJobs: number };

/** Provider-neutral Mongo polling worker. Claims and fencing are enforced atomically by the repository. */
export class AnalysisJobWorker {
  private readonly workerId = `api-${randomUUID()}`;
  private timer: NodeJS.Timeout | undefined;
  private polling = false;
  private stopped = true;
  private nextPollAllowedAt = 0;
  private pollFailureCount = 0;
  private lastSnapshotAt = 0;
  private snapshotRunning = false;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly repository: IDailyAnalysisRepository,
    private readonly processor: ProcessAnalysisJobUseCase,
    private readonly options: AnalysisJobWorkerOptions
  ) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 32) {
      throw new Error('ANALYSIS_JOB_CONCURRENCY must be an integer between 1 and 32.');
    }
    if (!Number.isInteger(options.pollIntervalMs) || options.pollIntervalMs < 100 || options.pollIntervalMs > 60_000) {
      throw new Error('ANALYSIS_JOB_POLL_INTERVAL_MS must be an integer between 100 and 60000.');
    }
    if (!Number.isInteger(options.leaseDurationMs) || options.leaseDurationMs < 10_000 || options.leaseDurationMs > 600_000) {
      throw new Error('ANALYSIS_JOB_LEASE_MS must be an integer between 10000 and 600000.');
    }
    if (options.shutdownGraceMs !== undefined &&
        (!Number.isInteger(options.shutdownGraceMs) || options.shutdownGraceMs < 1 || options.shutdownGraceMs >= options.leaseDurationMs)) {
      throw new Error('ANALYSIS_JOB_SHUTDOWN_GRACE_MS must be a positive integer shorter than the job lease.');
    }
    if (options.maxAttempts !== undefined && (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 10)) {
      throw new Error('ANALYSIS_JOB_MAX_ATTEMPTS must be an integer between 1 and 10.');
    }
    if (options.snapshotIntervalMs !== undefined &&
        (!Number.isInteger(options.snapshotIntervalMs) || options.snapshotIntervalMs < 10_000 || options.snapshotIntervalMs > 300_000)) {
      throw new Error('ANALYSIS_JOB_SNAPSHOT_INTERVAL_MS must be an integer between 10000 and 300000.');
    }
  }

  public start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.options.pollIntervalMs);
    this.timer.unref();
  }

  public async stop(): Promise<AnalysisJobWorkerStopResult> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const deadline = Date.now() + (this.options.shutdownGraceMs ?? Math.min(40_000, this.options.leaseDurationMs - 1));
    while (this.polling && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(10, Math.max(1, deadline - Date.now()))));
    }
    if (this.polling) return this.shutdownTimedOut();

    const tasks = [...this.inFlight];
    if (tasks.length === 0) return { status: 'drained', remainingJobs: 0 };

    let timeout: NodeJS.Timeout | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), Math.max(1, deadline - Date.now()));
    });
    const drained = Promise.allSettled(tasks).then(() => true as const);
    const didDrain = await Promise.race([drained, timedOut]);
    if (timeout) clearTimeout(timeout);
    return didDrain ? { status: 'drained', remainingJobs: 0 } : this.shutdownTimedOut();
  }

  private shutdownTimedOut(): AnalysisJobWorkerStopResult {
    this.options.onError?.('Analysis worker shutdown drain timed out; unfinished jobs remain recoverable through their leases.');
    return { status: 'timed_out', remainingJobs: this.inFlight.size };
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.polling || Date.now() < this.nextPollAllowedAt) return;
    this.polling = true;
    try {
      while (!this.stopped && this.inFlight.size < this.options.concurrency) {
        const job = await this.repository.claimNextAnalysisJob(
          this.workerId,
          new Date(),
          this.options.leaseDurationMs,
          this.options.maxAttempts ?? 4
        );
        this.pollFailureCount = 0;
        this.nextPollAllowedAt = 0;
        if (!job) break;
        const task = this.processor.execute(job)
          .catch(() => this.options.onError?.('Analysis job processing failed; details omitted.'))
          .finally(() => this.inFlight.delete(task));
        this.inFlight.add(task);
      }
    } catch {
      this.pollFailureCount += 1;
      const delayMs = Math.min(30_000, 1_000 * (2 ** Math.min(this.pollFailureCount - 1, 5)));
      this.nextPollAllowedAt = Date.now() + delayMs;
      if (this.pollFailureCount === 1 || (this.pollFailureCount & (this.pollFailureCount - 1)) === 0) {
        this.options.onError?.('Analysis job polling failed; details omitted.');
      }
    } finally {
      this.polling = false;
      this.scheduleSnapshot();
    }
  }

  private scheduleSnapshot(): void {
    if (this.stopped || !this.options.onSnapshot || this.snapshotRunning) return;
    const intervalMs = this.options.snapshotIntervalMs ?? 60_000;
    const now = Date.now();
    if (now - this.lastSnapshotAt < intervalMs) return;
    this.lastSnapshotAt = now;
    this.snapshotRunning = true;
    void this.repository.getAnalysisQueueSnapshot(new Date())
      .then((snapshot) => this.options.onSnapshot?.({
        ...snapshot,
        inFlightCount: this.inFlight.size,
        concurrency: this.options.concurrency,
        pollFailureCount: this.pollFailureCount
      }))
      .catch(() => this.options.onError?.('Analysis queue telemetry failed; details omitted.'))
      .finally(() => { this.snapshotRunning = false; });
  }
}
