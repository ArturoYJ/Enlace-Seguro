export abstract class DomainError extends Error {
  public abstract readonly code: string;
  public abstract readonly statusCode: number;

  constructor(message: string, public readonly detail?: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidCredentialsError extends DomainError {
  public readonly code = 'INVALID_CREDENTIALS';
  public readonly statusCode = 401;

  constructor(detail = 'Invalid email or password.') {
    super('Authentication failed', detail);
  }
}

export class TokenExpiredOrInvalidError extends DomainError {
  public readonly code = 'INVALID_OR_EXPIRED_TOKEN';
  public readonly statusCode = 401;

  constructor(detail = 'The provided token is expired, revoked, or malformed.') {
    super('Token verification failed', detail);
  }
}

export class TokenReuseDetectedError extends DomainError {
  public readonly code = 'TOKEN_REUSE_DETECTED';
  public readonly statusCode = 401;

  constructor(detail = 'Revoked refresh token reuse detected. Session terminated for security.') {
    super('Security alert: token reuse', detail);
  }
}

export class AccountDisabledError extends DomainError {
  public readonly code = 'ACCOUNT_DISABLED';
  public readonly statusCode = 401;

  constructor(detail = 'The user account has been disabled.') {
    super('Account inactive', detail);
  }
}

export class UnauthorizedAccessError extends DomainError {
  public readonly code = 'FORBIDDEN_ACCESS';
  public readonly statusCode = 403;

  constructor(detail = 'You do not have the required permissions to access this resource.') {
    super('Access denied', detail);
  }
}

export class ResourceNotFoundError extends DomainError {
  public readonly code = 'RESOURCE_NOT_FOUND';
  public readonly statusCode = 404;

  constructor(resource: string, identifier?: string) {
    const detail = identifier
      ? `${resource} with identifier '${identifier}' was not found.`
      : `${resource} was not found.`;
    super('Resource not found', detail);
  }
}

export class EmailAlreadyExistsError extends DomainError {
  public readonly code = 'EMAIL_ALREADY_EXISTS';
  public readonly statusCode = 409;

  constructor(email: string) {
    super('Email already registered', `The email address '${email}' is already associated with an account.`);
  }
}

export class QuotaExceededError extends DomainError {
  public readonly code = 'DAILY_QUOTA_EXCEEDED';
  public readonly statusCode = 429;

  constructor(dailyLimit = 5, timezone = 'America/Mexico_City') {
    super(
      'Daily analysis quota exceeded',
      `You have reached the maximum allowed limit of ${dailyLimit} link analysis requests for today in ${timezone}.`
    );
  }
}

export class ValidationError extends DomainError {
  public readonly code = 'VALIDATION_FAILED';
  public readonly statusCode = 400;

  constructor(detail: string, public readonly invalidParams?: Array<{ name: string; reason: string }>) {
    super('Validation failed', detail);
  }
}
