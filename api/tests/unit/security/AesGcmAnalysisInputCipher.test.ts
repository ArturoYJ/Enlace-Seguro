import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AesGcmAnalysisInputCipher } from '../../../src/infrastructure/security/AesGcmAnalysisInputCipher.js';

const context = {
  attemptId: '76a25274-e073-4cbf-b860-a257c4d6be9a',
  userId: '507f1f77bcf86cd799439011',
  localDate: '2026-11-03'
};

describe('AesGcmAnalysisInputCipher', () => {
  it('round-trips input with randomized ciphertext and authenticated context', () => {
    const cipher = new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x5a));
    const plaintext = `https://example.test/${'a'.repeat(65_500)}`;

    const first = cipher.encrypt(plaintext, context);
    const second = cipher.encrypt(plaintext, context);

    assert.notEqual(first.iv, second.iv);
    assert.notEqual(first.ciphertext, second.ciphertext);
    assert.equal(cipher.decrypt(first, context), plaintext);
    assert.throws(() => cipher.decrypt(first, { ...context, userId: '507f1f77bcf86cd799439012' }));
    assert.throws(() => new AesGcmAnalysisInputCipher(Buffer.alloc(32, 0x5b)).decrypt(first, context));
  });

  it('rejects malformed or non-canonical key configuration', () => {
    assert.throws(() => new AesGcmAnalysisInputCipher(Buffer.alloc(31)));
    assert.throws(() => AesGcmAnalysisInputCipher.fromBase64UrlKey('not-a-key'));

    const key = Buffer.alloc(32, 0x4c).toString('base64url');
    assert.equal(
      AesGcmAnalysisInputCipher.fromBase64UrlKey(key).decrypt(
        AesGcmAnalysisInputCipher.fromBase64UrlKey(key).encrypt('https://example.test', context), context
      ),
      'https://example.test'
    );
  });
});
