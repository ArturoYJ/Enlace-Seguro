import { createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ITokenService, AccessTokenPayload, DecodedAccessToken } from '../../core/ports/ISecurityServices.js';
import { TokenExpiredOrInvalidError } from '../../core/errors/DomainErrors.js';

export class JwtTokenService implements ITokenService {
  constructor(
    private readonly secret: string,
    private readonly expiresInSeconds = 900,
    private readonly issuer = 'enlaceseguro-api'
  ) {
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long for cryptographic security.');
    }
  }

  public generateAccessToken(payload: AccessTokenPayload): string {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.expiresInSeconds;
    const jti = payload.jti ?? randomUUID();

    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };

    const claims: DecodedAccessToken = {
      iss: this.issuer,
      sub: payload.userId,
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      jti,
      iat: now,
      exp
    } as unknown as DecodedAccessToken;

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    const signature = createHmac('sha256', this.secret).update(dataToSign).digest('base64url');

    return `${dataToSign}.${signature}`;
  }

  public verifyAccessToken(token: string): DecodedAccessToken {
    if (!token || typeof token !== 'string') {
      throw new TokenExpiredOrInvalidError('Missing or malformed token string.');
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new TokenExpiredOrInvalidError('Invalid JWT format.');
    }

    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
    const dataToVerify = `${headerB64}.${payloadB64}`;

    const expectedSignature = createHmac('sha256', this.secret).update(dataToVerify).digest('base64url');

    const expectedBuf = Buffer.from(expectedSignature);
    const actualBuf = Buffer.from(signatureB64);

    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      throw new TokenExpiredOrInvalidError('Invalid token signature.');
    }

    let payload: DecodedAccessToken;
    try {
      const decodedJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
      payload = JSON.parse(decodedJson) as DecodedAccessToken;
    } catch {
      throw new TokenExpiredOrInvalidError('Token payload is not valid JSON.');
    }

    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || now >= payload.exp) {
      throw new TokenExpiredOrInvalidError('Token has expired.');
    }

    return payload;
  }

  public generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  public hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
