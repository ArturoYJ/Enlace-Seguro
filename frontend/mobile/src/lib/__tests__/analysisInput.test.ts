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
});
