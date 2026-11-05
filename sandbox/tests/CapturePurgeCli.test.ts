import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const CLI_PATH = fileURLToPath(new URL('../src/operations/purgeCaptures.ts', import.meta.url));
const TSX_LOADER_PATH = createRequire(import.meta.url).resolve('tsx');
const OLD_ID = '43e31db7-f65c-4471-9222-d8743368a48c';
const RECENT_ID = '51614e16-f5b1-4b73-b749-11d456d61eb8';
const SYMLINK_ID = '2d351e30-a8c9-4cbc-a7d6-93d09017e06f';
const DAY_MS = 24 * 60 * 60 * 1000;

function runPurgeCli(cwd: string, args: string[] = []) {
  return spawnSync(process.execPath, ['--import', TSX_LOADER_PATH, CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10_000
  });
}

async function makeExpiredFile(filePath: string): Promise<void> {
  await fs.writeFile(filePath, 'synthetic capture');
  const old = new Date(Date.now() - 45 * DAY_MS);
  await fs.utimes(filePath, old, old);
}

describe('capture purge CLI safety gates', () => {
  it('defaults to a dry run and preserves expired captures', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'enlaceseguro-purge-cli-'));
    const captures = path.join(root, 'captures');
    const expiredFile = path.join(captures, `${OLD_ID}.webp`);
    try {
      await fs.mkdir(captures);
      await makeExpiredFile(expiredFile);

      const result = runPurgeCli(root);

      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        mode: 'dry-run',
        retentionDays: 30,
        eligible: 1,
        deleted: 0,
        skipped: 0
      });
      assert.equal(await fs.readFile(expiredFile, 'utf8'), 'synthetic capture');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects execute mode unless writes are explicitly paused', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'enlaceseguro-purge-cli-'));
    const captures = path.join(root, 'captures');
    const expiredFile = path.join(captures, `${OLD_ID}.webp`);
    try {
      await fs.mkdir(captures);
      await makeExpiredFile(expiredFile);

      const result = runPurgeCli(root, ['--execute']);

      assert.equal(result.status, 2);
      assert.match(result.stderr, /Usage: purgeCaptures/);
      assert.equal(await fs.readFile(expiredFile, 'utf8'), 'synthetic capture');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('deletes only old UUID WebP files when both safety flags are present', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'enlaceseguro-purge-cli-'));
    const captures = path.join(root, 'captures');
    const outsideFile = path.join(root, 'outside.webp');
    const expiredFile = path.join(captures, `${OLD_ID}.webp`);
    const recentFile = path.join(captures, `${RECENT_ID}.webp`);
    const invalidFile = path.join(captures, 'not-a-uuid.webp');
    const symlinkFile = path.join(captures, `${SYMLINK_ID}.webp`);
    try {
      await fs.mkdir(captures);
      await makeExpiredFile(expiredFile);
      await fs.writeFile(recentFile, 'recent capture');
      await fs.writeFile(invalidFile, 'invalid name');
      await fs.writeFile(outsideFile, 'outside target');
      const recent = new Date(Date.now() - DAY_MS);
      await fs.utimes(recentFile, recent, recent);
      const old = new Date(Date.now() - 45 * DAY_MS);
      await fs.utimes(invalidFile, old, old);
      await fs.symlink(outsideFile, symlinkFile);

      const result = runPurgeCli(root, ['--execute', '--writes-paused']);

      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        mode: 'execute',
        retentionDays: 30,
        eligible: 1,
        deleted: 1,
        skipped: 3
      });
      await assert.rejects(fs.stat(expiredFile), { code: 'ENOENT' });
      assert.equal(await fs.readFile(recentFile, 'utf8'), 'recent capture');
      assert.equal(await fs.readFile(invalidFile, 'utf8'), 'invalid name');
      assert.equal(await fs.readlink(symlinkFile), outsideFile);
      assert.equal(await fs.readFile(outsideFile, 'utf8'), 'outside target');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
