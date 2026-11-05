import path from 'node:path';
import { purgeLocalCaptures } from '../infrastructure/CapturePurge.js';

const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const args = process.argv.slice(2);
const execute = args.includes('--execute');
const writesPaused = args.includes('--writes-paused');

if (args.some((arg) => !['--execute', '--writes-paused'].includes(arg)) ||
    (execute && !writesPaused)) {
  console.error('Usage: purgeCaptures [--execute --writes-paused]');
  process.exitCode = 2;
} else {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS);
  const baseDir = path.resolve(process.cwd(), 'captures');
  purgeLocalCaptures(baseDir, cutoff, execute)
    .then((result) => {
      console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', retentionDays: RETENTION_DAYS, ...result }));
    })
    .catch(() => {
      console.error('Capture purge failed; check storage directory and permissions.');
      process.exitCode = 1;
    });
}
