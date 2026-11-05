import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { purgeLocalCaptures } from '../src/infrastructure/CapturePurge.js';

const OLD_ID = '43e31db7-f65c-4471-9222-d8743368a48c';
const RECENT_ID = '51614e16-f5b1-4b73-b749-11d456d61eb8';

describe('independent local capture purge', () => {
  it('previews then deletes only expired regular UUID WebP files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'enlaceseguro-purge-'));
    const dir = path.join(root, 'captures');
    const outside = path.join(root, 'outside.webp');
    await fs.mkdir(dir);
    const oldFile = path.join(dir, `${OLD_ID}.webp`);
    const recentFile = path.join(dir, `${RECENT_ID}.webp`);
    const invalidFile = path.join(dir, 'not-a-uuid.webp');
    const link = path.join(dir, '2d351e30-a8c9-4cbc-a7d6-93d09017e06f.webp');
    const cutoff = new Date('2026-10-01T00:00:00.000Z');
    const old = new Date('2026-09-01T00:00:00.000Z');
    const recent = new Date('2026-10-02T00:00:00.000Z');
    try {
      await Promise.all([
        fs.writeFile(oldFile, 'old'),
        fs.writeFile(recentFile, 'recent'),
        fs.writeFile(invalidFile, 'invalid'),
        fs.writeFile(outside, 'outside')
      ]);
      await fs.utimes(oldFile, old, old);
      await fs.utimes(recentFile, recent, recent);
      await fs.utimes(invalidFile, old, old);
      await fs.symlink(outside, link);

      assert.deepEqual(await purgeLocalCaptures(dir, cutoff), { eligible: 1, deleted: 0, skipped: 3 });
      assert.equal(await fs.readFile(oldFile, 'utf8'), 'old');
      assert.deepEqual(await purgeLocalCaptures(dir, cutoff, true), { eligible: 1, deleted: 1, skipped: 3 });
      await assert.rejects(fs.stat(oldFile), { code: 'ENOENT' });
      assert.equal(await fs.readFile(recentFile, 'utf8'), 'recent');
      assert.equal(await fs.readFile(invalidFile, 'utf8'), 'invalid');
      assert.equal(await fs.readFile(outside, 'utf8'), 'outside');
      assert.deepEqual(await purgeLocalCaptures(dir, cutoff, true), { eligible: 0, deleted: 0, skipped: 3 });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a symlink base and invalid cutoff without touching files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'enlaceseguro-purge-'));
    const dir = path.join(root, 'captures');
    const link = path.join(root, 'linked-captures');
    try {
      await fs.mkdir(dir);
      await fs.symlink(dir, link);
      await assert.rejects(purgeLocalCaptures(link, new Date(), true), /real directory/);
      await assert.rejects(purgeLocalCaptures(dir, new Date('invalid'), true), /valid date/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
