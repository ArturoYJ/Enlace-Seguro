import fs from 'node:fs/promises';
import path from 'node:path';

export interface IScreenshotStorage {
  saveScreenshot(attemptId: string, imageBuffer: Buffer): Promise<string>;
  getScreenshot(attemptId: string): Promise<Buffer | null>;
}

export class LocalScreenshotStorage implements IScreenshotStorage {
  constructor(private readonly baseDir: string = path.resolve(process.cwd(), 'captures')) {}

  public async init(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  public async saveScreenshot(attemptId: string, imageBuffer: Buffer): Promise<string> {
    await this.init();
    const filename = `${attemptId}.webp`;
    const filepath = path.join(this.baseDir, filename);
    await fs.writeFile(filepath, imageBuffer);
    return `local://captures/${filename}`;
  }

  public async getScreenshot(attemptId: string): Promise<Buffer | null> {
    const filepath = path.join(this.baseDir, `${attemptId}.webp`);
    try {
      return await fs.readFile(filepath);
    } catch {
      return null;
    }
  }
}
