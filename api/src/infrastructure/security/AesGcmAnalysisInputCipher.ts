import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  AnalysisInputEncryptionContext,
  EncryptedAnalysisInput,
  IAnalysisInputCipher
} from '../../core/ports/IAnalysisInputCipher.js';

const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;

function associatedData(context: AnalysisInputEncryptionContext): Buffer {
  return Buffer.from(`${context.userId}\0${context.localDate}\0${context.attemptId}`, 'utf8');
}

export class AesGcmAnalysisInputCipher implements IAnalysisInputCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error('ANALYSIS_INPUT_ENCRYPTION_KEY must decode to exactly 32 bytes.');
    }
  }

  public static fromBase64UrlKey(encodedKey: string): AesGcmAnalysisInputCipher {
    if (!/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) {
      throw new Error('ANALYSIS_INPUT_ENCRYPTION_KEY must be a canonical base64url-encoded 32-byte key.');
    }
    const key = Buffer.from(encodedKey, 'base64url');
    if (key.length !== 32 || key.toString('base64url') !== encodedKey) {
      throw new Error('ANALYSIS_INPUT_ENCRYPTION_KEY must be a canonical base64url-encoded 32-byte key.');
    }
    return new AesGcmAnalysisInputCipher(key);
  }

  public encrypt(plaintext: string, context: AnalysisInputEncryptionContext): EncryptedAnalysisInput {
    const iv = randomBytes(AES_GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: AES_GCM_TAG_BYTES });
    cipher.setAAD(associatedData(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      algorithm: 'aes-256-gcm',
      keyVersion: 'v1',
      iv: iv.toString('base64url'),
      authTag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url')
    };
  }

  public decrypt(encrypted: EncryptedAnalysisInput, context: AnalysisInputEncryptionContext): string {
    if (encrypted.algorithm !== 'aes-256-gcm' || encrypted.keyVersion !== 'v1') {
      throw new Error('Encrypted analysis input uses an unsupported algorithm or key version.');
    }
    const iv = Buffer.from(encrypted.iv, 'base64url');
    const authTag = Buffer.from(encrypted.authTag, 'base64url');
    const ciphertext = Buffer.from(encrypted.ciphertext, 'base64url');
    if (iv.length !== AES_GCM_IV_BYTES || authTag.length !== AES_GCM_TAG_BYTES ||
        iv.toString('base64url') !== encrypted.iv || authTag.toString('base64url') !== encrypted.authTag ||
        ciphertext.toString('base64url') !== encrypted.ciphertext) {
      throw new Error('Encrypted analysis input has an invalid encoding.');
    }

    const decipher = createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: AES_GCM_TAG_BYTES });
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
