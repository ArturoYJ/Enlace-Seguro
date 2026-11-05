import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNavigationFailure, isTlsCertificateValidationError } from '../src/core/classifyNavigationFailure.js';

describe('TLS certificate navigation failure classification', () => {
  it('recognizes Chromium certificate validation failures without parsing or exposing URLs', () => {
    assert.equal(isTlsCertificateValidationError(new Error('page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://example.test/secret')), true);
    assert.equal(isTlsCertificateValidationError(new Error('net::ERR_CERT_DATE_INVALID')), true);
    assert.equal(isTlsCertificateValidationError(new Error('net::ERR_CERT_COMMON_NAME_INVALID')), true);
  });

  it('does not classify timeout, DNS, or ordinary navigation failures as certificate errors', () => {
    assert.equal(isTlsCertificateValidationError(new Error('Timeout 15000ms exceeded')), false);
    assert.equal(isTlsCertificateValidationError(new Error('net::ERR_NAME_NOT_RESOLVED')), false);
    assert.equal(isTlsCertificateValidationError('net::ERR_CERT_AUTHORITY_INVALID'), true);
    assert.equal(isTlsCertificateValidationError('net::ERR_NAME_NOT_RESOLVED'), false);
  });

  it('maps navigation errors to safe signals without exposing error text or submitted URLs', () => {
    const raw = 'Navigation failed at https://victim.example/path?token=synthetic-secret';
    const signal = classifyNavigationFailure(new Error(raw));
    assert.equal(signal, 'navigation_failed');
    assert.equal(signal.includes('victim.example'), false);
    assert.equal(signal.includes('synthetic-secret'), false);
    assert.equal(classifyNavigationFailure(new Error('Timeout 15000ms exceeded')), 'navigation_timeout');
    assert.equal(classifyNavigationFailure(new Error('net::ERR_BLOCKED_BY_CLIENT'), true), 'ssrf_attempt_blocked');
  });
});
