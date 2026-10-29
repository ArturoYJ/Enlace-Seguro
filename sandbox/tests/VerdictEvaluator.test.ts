import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VerdictEvaluator } from '../src/core/VerdictEvaluator.js';

describe('VerdictEvaluator', () => {
  it('should categorize SSRF blocks as peligroso', () => {
    const result = VerdictEvaluator.evaluate({
      targetUrl: 'http://169.254.169.254/latest/meta-data',
      finalDestination: 'http://169.254.169.254/latest/meta-data',
      redirects: [],
      signals: [],
      blockedSsrf: true,
      ssrfReason: 'Cloud metadata access blocked'
    });

    assert.equal(result.verdict, 'peligroso');
    assert.ok(result.reasons.some((r) => r.includes('metadata')));
    assert.ok(result.signals.includes('ssrf_attempt_blocked'));
  });

  it('should categorize password input on plain HTTP as peligroso', () => {
    const result = VerdictEvaluator.evaluate({
      targetUrl: 'http://insecure-login.example',
      finalDestination: 'http://insecure-login.example/auth',
      redirects: [],
      signals: ['password_input_on_http']
    });

    assert.equal(result.verdict, 'peligroso');
    assert.ok(result.reasons.some((r) => r.includes('no cifrada')));
  });

  it('should categorize excessive redirect chains (>=3) as sospechoso', () => {
    const result = VerdictEvaluator.evaluate({
      targetUrl: 'https://tinyurl.example/abc',
      finalDestination: 'https://destination.example/home',
      redirects: [
        'https://hop1.example',
        'https://hop2.example',
        'https://destination.example/home'
      ],
      signals: []
    });

    assert.equal(result.verdict, 'sospechoso');
    assert.ok(result.reasons.some((r) => r.includes('redirecciones encadenadas')));
  });

  it('should categorize cross-domain redirects as sospechoso', () => {
    const result = VerdictEvaluator.evaluate({
      targetUrl: 'https://initial-site.example',
      finalDestination: 'https://completely-different-site.example',
      redirects: ['https://completely-different-site.example'],
      signals: []
    });

    assert.equal(result.verdict, 'sospechoso');
    assert.ok(result.reasons.some((r) => r.includes('dominio diferente')));
  });

  it('should emit sin_amenazas_detectadas with cautionary caveat when no signals triggered', () => {
    const result = VerdictEvaluator.evaluate({
      targetUrl: 'https://clean-site.example',
      finalDestination: 'https://clean-site.example',
      redirects: [],
      signals: []
    });

    assert.equal(result.verdict, 'sin_amenazas_detectadas');
    assert.ok(result.reasons.some((r) => r.includes('no constituye garantía de seguridad absoluta')));
  });
});
