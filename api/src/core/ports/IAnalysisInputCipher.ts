export interface AnalysisInputEncryptionContext {
  attemptId: string;
  userId: string;
  localDate: string;
}

export interface EncryptedAnalysisInput {
  algorithm: 'aes-256-gcm';
  keyVersion: 'v1';
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface IAnalysisInputCipher {
  encrypt(plaintext: string, context: AnalysisInputEncryptionContext): EncryptedAnalysisInput;
  decrypt(encrypted: EncryptedAnalysisInput, context: AnalysisInputEncryptionContext): string;
}
