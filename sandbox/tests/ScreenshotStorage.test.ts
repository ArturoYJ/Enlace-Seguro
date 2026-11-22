import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';

let baseDir: string;

after(async () => {
  if (baseDir) await fs.rm(baseDir, { recursive: true, force: true });
});

describe('LocalScreenshotStorage attempt identifier handling', () => {
  it('rejects path-like IDs before writing or reading capture files', async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'enlaceseguro-captures-'));
    const storage = new LocalScreenshotStorage(baseDir);

    await assert.rejects(storage.saveScreenshot('../outside', Buffer.from('fixture')),
      /attemptId must be a valid UUID/);
    assert.equal(await storage.getScreenshot('../outside'), null);
    assert.deepEqual(await fs.readdir(baseDir), []);
  });

  it('never stores or serves PNG bytes under a WebP filename', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'enlaceseguro-captures-'));
    const attemptId = '08bc3d8a-1277-4d09-a7b4-5ac6ab88de79';
    const storage = new LocalScreenshotStorage(dir);
    try {
      await assert.rejects(
        storage.saveScreenshot(attemptId, Buffer.from('89504e470d0a1a0a', 'hex')),
        /Capture must be WebP data/
      );
      assert.deepEqual(await fs.readdir(dir), []);

      await fs.writeFile(path.join(dir, `${attemptId}.webp`), Buffer.from('89504e470d0a1a0a', 'hex'));
      assert.equal(await storage.getScreenshot(attemptId), null);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('does not follow a capture filename symlink outside the storage directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'enlaceseguro-captures-'));
    const dir = path.join(root, 'captures');
    const outside = path.join(root, 'outside.webp');
    const attemptId = '44227ae3-6b7d-4be3-a738-72b53ecb8742';
    const image = Buffer.from('RIFF\x00\x00\x00\x00WEBP');
    await fs.mkdir(dir);
    await fs.writeFile(outside, image);
    await fs.symlink(outside, path.join(dir, `${attemptId}.webp`));
    const storage = new LocalScreenshotStorage(dir);
    try {
      assert.equal(await storage.getScreenshot(attemptId), null);
      await assert.rejects(storage.saveScreenshot(attemptId, image));
      assert.deepEqual(await fs.readFile(outside), image);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('LocalScreenshotStorage sin O_NOFOLLOW (como en Windows)', () => {
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  const attemptId = '1f2e3d4c-5b6a-4789-8abc-def012345678';

  it('guarda y lee la captura', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'enlaceseguro-captures-'));
    try {
      const storage = new LocalScreenshotStorage(dir, 0);
      assert.equal(await storage.saveScreenshot(attemptId, webp), `local://captures/${attemptId}.webp`);
      assert.deepEqual(await storage.getScreenshot(attemptId), webp);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('no escribe ni lee a través de un enlace simbólico', { skip: process.platform === 'win32' }, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'enlaceseguro-captures-'));
    const outside = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'enlaceseguro-outside-')), 'target.webp');
    try {
      await fs.writeFile(outside, webp);
      await fs.symlink(outside, path.join(dir, `${attemptId}.webp`));
      const storage = new LocalScreenshotStorage(dir, 0);
      await assert.rejects(storage.saveScreenshot(attemptId, Buffer.concat([webp, Buffer.from('x')])), /symbolic link/);
      assert.equal(await storage.getScreenshot(attemptId), null);
      assert.deepEqual(await fs.readFile(outside), webp);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
      await fs.rm(path.dirname(outside), { recursive: true, force: true });
    }
  });
});
