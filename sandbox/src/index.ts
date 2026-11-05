import 'dotenv/config';
import { PlaywrightContextPool } from './infrastructure/PlaywrightContextPool.js';
import { LocalScreenshotStorage } from './infrastructure/ScreenshotStorage.js';
import { buildSandboxServer } from './presentation/sandboxServer.js';

async function main() {
  const port = parseInt(process.env['PORT'] || '3001', 10);
  const host = process.env['HOST'] || '0.0.0.0';
  const concurrency = parseInt(process.env['MAX_CONCURRENCY'] || '3', 10);
  const analysisDeadlineMs = Number(process.env['SANDBOX_ANALYSIS_DEADLINE_MS'] ?? 25_000);
  if (!Number.isInteger(analysisDeadlineMs) || analysisDeadlineMs < 1_000 || analysisDeadlineMs > 28_000) {
    throw new Error('SANDBOX_ANALYSIS_DEADLINE_MS must be an integer between 1000 and 28000 milliseconds.');
  }
  const serviceToken = process.env['SANDBOX_SERVICE_TOKEN'];
  if (!serviceToken || Buffer.byteLength(serviceToken, 'utf8') < 32 || /\s/.test(serviceToken)) {
    throw new Error('SANDBOX_SERVICE_TOKEN must be configured with at least 32 UTF-8 bytes and no whitespace.');
  }

  const storage = new LocalScreenshotStorage();
  await storage.init();

  const pool = new PlaywrightContextPool(storage, concurrency, undefined, undefined, analysisDeadlineMs);
  await pool.init();

  const app = buildSandboxServer({ pool, storage, serviceToken });

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`[INFO] Received ${signal}. Closing sandbox pool...`);
      await app.close();
      await pool.close();
      console.log('[INFO] Sandbox pool closed. Exiting process.');
      process.exit(0);
    });
  }

  try {
    await app.listen({ port, host });
    console.log(`[READY] EnlaceSeguro Sandbox Service listening at http://${host}:${port}`);
  } catch (err) {
    console.error('[FATAL] Sandbox service startup failed:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[FATAL] Uncaught error in sandbox bootstrap:', err);
  process.exit(1);
});
