import { it } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler, requestPathWithoutQuery } from '../../../src/presentation/plugins/errorHandler.js';
import { AnalysisQueueCapacityExceededError, AnalysisQueueUnavailableError, LoginRateLimitUnavailableError, RateLimitExceededError } from '../../../src/core/errors/DomainErrors.js';

function invokeErrorHandler(error: Error, requestTarget = '/api/v1/auth/login?token=synthetic-canary') {
  const result: { status?: number; headers: Record<string, string>; body?: unknown; logs: Array<{ fields: unknown; message: string }> } = { headers: {}, logs: [] };
  const reply = {
    status(status: number) {
      result.status = status;
      return this;
    },
    header(name: string, value: string) {
      result.headers[name.toLowerCase()] = value;
      return this;
    },
    send(body: unknown) {
      result.body = body;
      return this;
    }
  };
  const request = {
    id: 'request-synthetic-123',
    method: 'POST',
    url: requestTarget,
    log: { error(fields: unknown, message: string) { result.logs.push({ fields, message }); } }
  };
  errorHandler(error as never, request as never, reply as never);
  return result;
}

it('returns Retry-After with a 429 login rate-limit problem', () => {
  const response = invokeErrorHandler(new RateLimitExceededError(17));
  assert.equal(response.status, 429);
  assert.equal(response.headers['retry-after'], '17');
  assert.equal((response.body as { status: number }).status, 429);
});

it('returns a generic fail-closed 503 problem when rate-limit storage is unavailable', () => {
  const response = invokeErrorHandler(new LoginRateLimitUnavailableError());
  assert.equal(response.status, 503);
  assert.equal(response.headers['retry-after'], undefined);
  assert.equal((response.body as { status: number }).status, 503);
});

it('returns Retry-After with a queue-capacity 503 problem', () => {
  const response = invokeErrorHandler(new AnalysisQueueCapacityExceededError(5));
  assert.equal(response.status, 503);
  assert.equal(response.headers['retry-after'], '5');
  assert.equal((response.body as { status: number }).status, 503);
});

it('returns a generic fail-closed 503 when global queue capacity storage is unavailable', () => {
  const response = invokeErrorHandler(new AnalysisQueueUnavailableError());
  assert.equal(response.status, 503);
  assert.equal(response.headers['retry-after'], undefined);
  assert.equal((response.body as { status: number }).status, 503);
});

it('removes query strings from Problem Details instances', () => {
  const response = invokeErrorHandler(new RateLimitExceededError(17), '/api/v1/auth/login?token=synthetic-canary&secret=other-canary');
  const body = response.body as { instance: string };
  assert.equal(body.instance, '/api/v1/auth/login');
  assert.equal(JSON.stringify(response.body).includes('synthetic-canary'), false);
  assert.equal(JSON.stringify(response.body).includes('other-canary'), false);
});

it('logs only the approved request fields for unexpected 500s and excludes the raw error', () => {
  const error = new Error('synthetic-canary token=private-value');
  error.stack = 'Error: synthetic-canary\n    at /private/path?secret=other-canary';
  const response = invokeErrorHandler(error, '/api/v1/analyses/attempt-1?token=synthetic-canary');
  const log = response.logs[0];

  assert.equal(response.status, 500);
  assert.equal((response.body as { instance: string }).instance, '/api/v1/analyses/attempt-1');
  assert.deepEqual(log, {
    fields: {
      requestId: 'request-synthetic-123',
      method: 'POST',
      path: '/api/v1/analyses/attempt-1',
      statusCode: 500
    },
    message: 'Unhandled internal server error'
  });
  const serialized = JSON.stringify({ body: response.body, logs: response.logs });
  assert.equal(serialized.includes('synthetic-canary'), false);
  assert.equal(serialized.includes('other-canary'), false);
  assert.equal(serialized.includes('private-value'), false);
  assert.equal(serialized.includes('stack'), false);
});

it('normalizes empty request targets to the root path', () => {
  assert.equal(requestPathWithoutQuery('?token=synthetic-canary'), '/');
});
