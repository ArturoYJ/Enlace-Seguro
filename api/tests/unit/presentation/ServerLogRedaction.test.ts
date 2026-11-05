import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildServer } from '../../../src/presentation/server.js';

describe('API emitted log redaction', () => {
  it('keeps query strings and internal exception details out of request and 500 logs', async () => {
    const logLines: string[] = [];
    const server = buildServer({
      mongoConnection: { ping: async () => true } as never,
      tokenService: {} as never,
      authDeps: {
        registerUserUseCase: {
          execute: async () => { throw new Error('synthetic_internal_exception_canary'); }
        } as never
      } as never,
      analysisDeps: {} as never,
      adminDeps: {} as never,
      environment: 'development',
      loggerStream: { write: (line) => { logLines.push(line); } }
    });

    try {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register?token=synthetic_query_canary',
        payload: { email: 'synthetic@example.test', password: 'synthetic_body_canary' }
      });

      assert.equal(response.statusCode, 500);
      assert.doesNotMatch(response.body, /synthetic_query_canary|synthetic_internal_exception_canary|synthetic_body_canary/);
    } finally {
      await server.close();
    }

    const serialized = logLines.join('');
    assert.doesNotMatch(serialized, /synthetic_query_canary|synthetic_internal_exception_canary|synthetic_body_canary/);
    const records = logLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const failure = records.find((record) => record['msg'] === 'Unhandled internal server error');
    assert.ok(failure, 'expected allowlisted internal-error log record');
    assert.equal(failure['method'], 'POST');
    assert.equal(failure['path'], '/api/v1/auth/register');
    assert.equal(failure['statusCode'], 500);
    assert.equal(typeof failure['requestId'], 'string');
    assert.ok(String(failure['requestId']).length > 0);
  });
});
