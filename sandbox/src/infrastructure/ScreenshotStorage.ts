import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { isAttemptId } from '../core/identifiers.js';

export interface IScreenshotStorage {
  saveScreenshot(attemptId: string, imageBuffer: Buffer): Promise<string>;
  getScreenshot(attemptId: string): Promise<Buffer | null>;
}

function isWebp(buffer: Buffer): boolean {
  return buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP';
}

/**
 * Windows no tiene O_NOFOLLOW. Antes la clase lanzaba un error ahí y, como guardar la captura es
 * "best effort", en Windows nunca se guardaba ninguna. Sin esa bandera se revisa con lstat que la
 * ruta no sea un enlace simbólico antes de abrirla (en Windows crear enlaces requiere privilegios).
 */
async function assertNotSymlink(filepath: string): Promise<void> {
  try {
    if ((await fs.lstat(filepath)).isSymbolicLink()) throw new Error('Capture path must not be a symbolic link.');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export class LocalScreenshotStorage implements IScreenshotStorage {
  private readonly baseDir: string;

  private readonly noFollow: number;

  constructor(baseDir: string = path.resolve(process.cwd(), 'captures'), noFollow: number = constants.O_NOFOLLOW ?? 0) {
    this.baseDir = path.resolve(baseDir);
    this.noFollow = noFollow;
  }

  private async openFile(filepath: string, flags: number, mode?: number) {
    if (!this.noFollow) await assertNotSymlink(filepath);
    return fs.open(filepath, flags | this.noFollow, mode);
  }

  /**
   * Ruta del archivo de captura. Además de exigir un UUID, comprueba que la ruta resuelta quede
   * dentro de la carpeta de capturas: si alguien relaja la validación del identificador en el
   * futuro, un "../" sigue sin poder salir de esa carpeta.
   */
  private capturePath(attemptId: string): string | null {
    if (!isAttemptId(attemptId)) return null;
    const filepath = path.resolve(this.baseDir, `${attemptId}.webp`);
    if (!filepath.startsWith(this.baseDir + path.sep)) return null;
    return filepath;
  }

  public async init(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true, mode: 0o700 });
  }

  public async saveScreenshot(attemptId: string, imageBuffer: Buffer): Promise<string> {
    const filepath = this.capturePath(attemptId);
    if (!filepath) throw new Error('attemptId must be a valid UUID.');
    if (!isWebp(imageBuffer)) throw new Error('Capture must be WebP data.');
    await this.init();
    const filename = path.basename(filepath);
    const file = await this.openFile(filepath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
    try {
      await file.chmod(0o600);
      await file.writeFile(imageBuffer);
    } finally {
      await file.close();
    }
    return `local://captures/${filename}`;
  }

  public async getScreenshot(attemptId: string): Promise<Buffer | null> {
    const filepath = this.capturePath(attemptId);
    if (!filepath) return null;
    try {
      const file = await this.openFile(filepath, constants.O_RDONLY);
      try {
        if (!(await file.stat()).isFile()) return null;
        const buffer = await file.readFile();
        return isWebp(buffer) ? buffer : null;
      } finally {
        await file.close();
      }
    } catch {
      return null;
    }
  }
}
