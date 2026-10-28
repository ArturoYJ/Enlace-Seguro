import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JwtTokenService } from '../../../src/infrastructure/security/JwtTokenService.js';
import { TokenExpiredOrInvalidError } from '../../../src/core/errors/DomainErrors.js';

describe('JwtTokenService', () => {
  const secret = 'test_secret_must_be_at_least_32_characters_long_for_security!';
  const tokenService = new JwtTokenService(secret, 900);

  it('should generate a valid JWT with 3 base64url segments', () => {
    const token = tokenService.generateAccessToken({
      userId: '653b6f2e8f1b2c0012a4b890',
      email: 'test@example.com',
      role: 'usuario'
    });

    assert.ok(token);
    const parts = token.split('.');
    assert.equal(parts.length, 3);
  });

  it('should verify and decode valid JWT payload correctly', () => {
    const payload = {
      userId: '653b6f2e8f1b2c0012a4b890',
      email: 'user@enlaceseguro.internal',
      role: 'usuario' as const
    };

    const token = tokenService.generateAccessToken(payload);
    const decoded = tokenService.verifyAccessToken(token);

    assert.equal(decoded.userId, payload.userId);
    assert.equal(decoded.email, payload.email);
    assert.equal(decoded.role, payload.role);
    assert.ok(decoded.exp > decoded.iat);
  });

  it('should throw TokenExpiredOrInvalidError if token signature is tampered', () => {
    const token = tokenService.generateAccessToken({
      userId: '653b6f2e8f1b2c0012a4b890',
      email: 'user@example.com',
      role: 'usuario'
    });

    const parts = token.split('.');
    const tamperedToken = `${parts[0]}.${parts[1]}.tamperedSignatureHere`;

    assert.throws(
      () => tokenService.verifyAccessToken(tamperedToken),
      TokenExpiredOrInvalidError
    );
  });

  it('should throw TokenExpiredOrInvalidError if token is expired', () => {
    const expiredService = new JwtTokenService(secret, -10); // Expired 10 seconds ago
    const expiredToken = expiredService.generateAccessToken({
      userId: '653b6f2e8f1b2c0012a4b890',
      email: 'user@example.com',
      role: 'usuario'
    });

    assert.throws(
      () => tokenService.verifyAccessToken(expiredToken),
      TokenExpiredOrInvalidError
    );
  });

  it('should generate high entropy base64url refresh tokens and deterministic sha256 hashes', () => {
    const token1 = tokenService.generateRefreshToken();
    const token2 = tokenService.generateRefreshToken();

    assert.notEqual(token1, token2);
    assert.ok(token1.length >= 40);

    const hash1 = tokenService.hashToken(token1);
    const hash2 = tokenService.hashToken(token1);

    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
  });
});
