import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { SandboxServiceError } from '../../../src/core/errors/DomainErrors.js';
import { HttpSandboxService, resolveSandboxServiceUrl, validateSandboxServiceUrl } from '../../../src/infrastructure/sandbox/HttpSandboxService.js';

const serviceToken = 'test_sandbox_service_token_32_bytes_long';

describe('HttpSandboxService service authentication', () => {
  it('retrieves only WebP captures with the internal bearer, no redirects, and a bounded response contract', async (t) => {
    const calls: Array<{ url: string; headers: Headers; redirect?: RequestRedirect }> = [];
    const bytes = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
    t.mock.method(globalThis, 'fetch', async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers), redirect: init?.redirect });
      return new Response(bytes, { status: 200, headers: { 'content-type': 'image/webp', 'content-length': String(bytes.length) } });
    });
    const service = new HttpSandboxService('https://sandbox.internal', serviceToken);
    assert.deepEqual(Array.from((await service.getCapture('attempt-id')) ?? []), Array.from(bytes));
    assert.equal(calls[0]?.url, 'https://sandbox.internal/captures/attempt-id');
    assert.equal(calls[0]?.headers.get('authorization'), `Bearer ${serviceToken}`);
    assert.equal(calls[0]?.redirect, 'error');
  });

  it('rejects mislabeled or malformed capture bytes and returns null for missing captures', async (t) => {
    let response = new Response('not webp', { status: 200, headers: { 'content-type': 'image/png' } });
    t.mock.method(globalThis, 'fetch', async () => response);
    const service = new HttpSandboxService('https://sandbox.internal', serviceToken);
    await assert.rejects(service.getCapture('attempt-id'), /sandbox_capture_invalid_response/);
    response = new Response(null, { status: 404 });
    assert.equal(await service.getCapture('attempt-id'), null);
  });

  it('rejects an oversized streamed capture even without a Content-Length header', async (t) => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5 * 1024 * 1024));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() { cancelled = true; }
    });
    t.mock.method(globalThis, 'fetch', async () => new Response(stream, { headers: { 'content-type': 'image/webp' } }));
    const service = new HttpSandboxService('https://sandbox.internal', serviceToken);
    await assert.rejects(service.getCapture('attempt-id'), /sandbox_capture_invalid_response/);
    assert.equal(cancelled, true);
  });

  it('sends a bearer token only to internal analysis calls, not health probes', async (t) => {
    const requests: Array<{ url: string; headers: Headers; redirect?: RequestRedirect }> = [];
    t.mock.method(globalThis, 'fetch', async (input, init) => {
      const url = String(input);
      requests.push({ url, headers: new Headers(init?.headers), redirect: init?.redirect });
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'healthy' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        outcome: 'completed',
        attemptId: 'attempt-1',
        targetUrl: 'https://example.com',
        finalDestination: 'https://example.com/',
        redirects: [],
        signals: [],
        verdict: 'sin_amenazas_detectadas',
        reasons: [],
        sourceResults: []
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const service = new HttpSandboxService('https://sandbox.internal', serviceToken);
    await service.analyze('attempt-1', 'https://example.com');
    assert.equal(requests[0]?.headers.get('authorization'), `Bearer ${serviceToken}`);
    assert.equal(await service.isHealthy(), true);
    assert.equal(requests[1]?.headers.has('authorization'), false);
    assert.equal(requests[0]?.redirect, 'error');
    assert.equal(requests[1]?.redirect, 'error');
  });

  it('fails closed when the service token is weak', () => {
    assert.throws(() => new HttpSandboxService('https://sandbox.internal', 'weak'), /at least 32 UTF-8 bytes/);
  });

  it('bounds the analysis HTTP request with a configurable abort timeout', async (t) => {
    let receivedSignal: AbortSignal | undefined;
    let configuredTimeout = 0;
    const originalTimeout = AbortSignal.timeout;
    t.mock.method(AbortSignal, 'timeout', (delayMs: number) => {
      configuredTimeout = delayMs;
      return originalTimeout(delayMs);
    });
    t.mock.method(globalThis, 'fetch', async (_input, init) => {
      receivedSignal = init?.signal as AbortSignal | undefined;
      return new Response(JSON.stringify({
        outcome: 'completed', attemptId: 'attempt-1', targetUrl: 'https://example.com', finalDestination: 'https://example.com/',
        redirects: [], signals: [], verdict: 'sin_amenazas_detectadas', reasons: [], sourceResults: []
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const service = new HttpSandboxService('https://sandbox.internal', serviceToken, 7_500);
    await service.analyze('attempt-1', 'https://example.com');
    assert.equal(configuredTimeout, 7_500);
    assert.ok(receivedSignal instanceof AbortSignal);
  });

  it('rejects an unsafe analysis timeout configuration', () => {
    assert.throws(() => new HttpSandboxService('https://sandbox.internal', serviceToken, 0), /between 1 and 120000/);
  });

  it('treats the Sandbox global-deadline 504 response as retryable', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      error: 'Gateway Timeout', message: 'The analysis exceeded its processing deadline.'
    }), { status: 504, headers: { 'content-type': 'application/json' } }));
    const service = new HttpSandboxService('https://sandbox.internal', serviceToken);
    await assert.rejects(service.analyze('attempt-1', 'https://example.test'), (error: unknown) => {
      assert.ok(error instanceof SandboxServiceError);
      assert.equal(error.reasonCode, 'sandbox_http_504');
      assert.equal(error.retryable, true);
      return true;
    });
  });

  it('treats a generic Sandbox navigation 502 response as retryable', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      error: 'Bad Gateway', message: 'The destination could not be inspected.'
    }), { status: 502, headers: { 'content-type': 'application/json' } }));
    const service = new HttpSandboxService('https://sandbox.internal', serviceToken);
    await assert.rejects(service.analyze('attempt-1', 'https://example.test'), (error: unknown) => {
      assert.ok(error instanceof SandboxServiceError);
      assert.equal(error.reasonCode, 'sandbox_http_502');
      assert.equal(error.retryable, true);
      return true;
    });
  });

  it('accepts only the explicit no-verdict TLS inconclusive marker', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      outcome: 'inconclusive', reasonCode: 'tls_certificate_invalid', attemptId: 'attempt-1',
      targetUrl: 'https://example.com', finalDestination: 'https://example.com', redirects: [],
      signals: ['tls_certificate_validation_failed'], sourceResults: []
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const service = new HttpSandboxService('https://sandbox.internal', serviceToken);
    assert.deepEqual(await service.analyze('attempt-1', 'https://example.com'), {
      outcome: 'inconclusive', reasonCode: 'tls_certificate_invalid', attemptId: 'attempt-1',
      targetUrl: 'https://example.com', finalDestination: 'https://example.com', redirects: [],
      signals: ['tls_certificate_validation_failed'], sourceResults: []
    });
  });

  it('accepts the explicit resource-limit inconclusive marker without a verdict', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      outcome: 'inconclusive', reasonCode: 'resource_limit_exceeded', attemptId: 'attempt-1',
      targetUrl: 'https://example.com', finalDestination: 'https://example.com', redirects: [],
      signals: ['resource_limit_exceeded'], sourceResults: []
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const service = new HttpSandboxService('https://sandbox.internal', serviceToken);
    assert.deepEqual(await service.analyze('attempt-1', 'https://example.com'), {
      outcome: 'inconclusive', reasonCode: 'resource_limit_exceeded', attemptId: 'attempt-1',
      targetUrl: 'https://example.com', finalDestination: 'https://example.com', redirects: [],
      signals: ['resource_limit_exceeded'], sourceResults: []
    });
  });

  it('rejects unknown inconclusive reason codes and legacy verdicts without an outcome', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      outcome: 'inconclusive', reasonCode: 'raw_browser_error', attemptId: 'attempt-1',
      targetUrl: 'https://example.com', finalDestination: 'https://example.com', redirects: [],
      signals: [], sourceResults: []
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const service = new HttpSandboxService('https://sandbox.internal', serviceToken);
    await assert.rejects(service.analyze('attempt-1', 'https://example.com'), /sandbox_invalid_response/);
  });

  it('rejects an inconclusive response that attempts to include a verdict', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
      outcome: 'inconclusive', reasonCode: 'tls_certificate_invalid', attemptId: 'attempt-1',
      targetUrl: 'https://example.com', finalDestination: 'https://example.com', redirects: [],
      signals: [], sourceResults: [], verdict: 'sin_amenazas_detectadas', reasons: []
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const service = new HttpSandboxService('https://sandbox.internal', serviceToken);
    await assert.rejects(service.analyze('attempt-1', 'https://example.com'), /sandbox_invalid_response/);
  });

  it('requires an explicitly configured HTTPS endpoint in production', () => {
    assert.equal(resolveSandboxServiceUrl(undefined, 'development'), 'http://localhost:3001');
    assert.equal(resolveSandboxServiceUrl('https://sandbox.internal', 'production'), 'https://sandbox.internal');
    assert.throws(() => resolveSandboxServiceUrl(undefined, 'production'), /explicitly configured as HTTPS/);
    assert.throws(() => resolveSandboxServiceUrl('http://localhost:3001', 'production'), /must use HTTPS/);
  });

  it('allows HTTP only on loopback outside production', () => {
    assert.equal(validateSandboxServiceUrl('http://127.0.0.1:3001', 'test'), 'http://127.0.0.1:3001');
    assert.equal(validateSandboxServiceUrl('http://[::1]:3001', 'development'), 'http://[::1]:3001');
    assert.throws(() => validateSandboxServiceUrl('http://sandbox.internal', 'development'), /must use HTTPS/);
    assert.throws(() => validateSandboxServiceUrl('http://localhost:3001', 'production'), /must use HTTPS/);
  });

  it('rejects malformed or ambiguous service URLs', () => {
    for (const url of [
      'not-a-url',
      'ftp://sandbox.internal',
      'https://user:password@sandbox.internal',
      'https://@sandbox.internal',
      'https://sandbox.internal?token=secret',
      'https://sandbox.internal?',
      'https://sandbox.internal#fragment',
      'https://sandbox.internal#'
    ]) {
      assert.throws(() => validateSandboxServiceUrl(url, 'production'));
    }
  });

  it('uses Node strict TLS defaults for real Sandbox transport and does not send requests to an untrusted certificate', async (t) => {
    const cert = new URL('../../../../sandbox/browser-tests/fixtures/localhost.cert.pem', import.meta.url);
    const key = new URL('../../../../sandbox/browser-tests/fixtures/localhost.key.pem', import.meta.url);
    let receivedRequests = 0;
    const server = createHttpsServer({
      cert: readFileSync(cert),
      key: readFileSync(key)
    }, (_request, response) => {
      receivedRequests += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'healthy' }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    t.after(async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    });

    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const service = new HttpSandboxService(`https://127.0.0.1:${address.port}`, serviceToken);
    await assert.rejects(service.analyze('attempt-1', 'https://example.com'), (error: unknown) => {
      assert.ok(error instanceof SandboxServiceError);
      assert.equal(error.reasonCode, 'sandbox_transport_error');
      return true;
    });
    assert.equal(await service.isHealthy(), false);
    assert.equal(receivedRequests, 0);
  });
});
