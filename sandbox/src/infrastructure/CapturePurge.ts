import fs from 'node:fs/promises';
import path from 'node:path';
import { isAttemptId } from '../core/identifiers.js';

export interface CapturePurgeResult {
  eligible: number;
  deleted: number;
  skipped: number;
}

/** The caller must stop capture writes before requesting deletion. */
export async function purgeLocalCaptures(
  baseDir: string,
  cutoff: Date,
  execute = false
): Promise<CapturePurgeResult> {
  if (Number.isNaN(cutoff.getTime())) throw new Error('Capture purge cutoff must be a valid date.');

  let directory;
  try {
    directory = await fs.lstat(baseDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { eligible: 0, deleted: 0, skipped: 0 };
    }
    throw error;
  }
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error('Capture purge base must be a real directory.');
  }

  const result: CapturePurgeResult = { eligible: 0, deleted: 0, skipped: 0 };
  for (const entry of await fs.readdir(baseDir, { withFileTypes: true })) {
    const attemptId = entry.name.endsWith('.webp') ? entry.name.slice(0, -5) : '';
    if (!entry.isFile() || !isAttemptId(attemptId) || attemptId !== attemptId.toLowerCase()) {
      result.skipped++;
      continue;
    }
    const filePath = path.join(baseDir, entry.name);
    const metadata = await fs.lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.mtimeMs >= cutoff.getTime()) {
      result.skipped++;
      continue;
    }
    result.eligible++;
    if (execute) {
      await fs.unlink(filePath);
      result.deleted++;
    }
  }
  return result;
}
