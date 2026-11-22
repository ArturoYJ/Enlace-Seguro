import { readableSummary, reputationInfo } from '../reputationSummary';

describe('reputationSummary', () => {
  it('cambia la fecha ISO del resumen por una fecha legible en hora de México', () => {
    const text = readableSummary('Informe del 2026-11-22T04:39:54.000Z; detecciones maliciosas: 0.');
    expect(text).not.toMatch(/T04:39/);
    expect(text).toMatch(/21 nov 2026/);
    expect(text).toMatch(/detecciones maliciosas: 0\.$/);
  });

  it('marca en rojo cuando hay detecciones y en verde cuando no las hay', () => {
    expect(reputationInfo([{ sourceName: 'VirusTotal', status: 'match', summary: 'x' }]).tone).toBe('danger');
    expect(reputationInfo([{ sourceName: 'VirusTotal', status: 'no_match' }])).toEqual(
      expect.objectContaining({ chip: 'Sin detecciones', tone: 'success' }));
  });

  it('explica cada motivo de no tener resultado', () => {
    expect(reputationInfo([], [{ sourceName: 'VirusTotal', reasonCode: 'not_found' }]).chip).toBe('Sin informe');
    expect(reputationInfo([], [{ sourceName: 'VirusTotal', reasonCode: 'not_queried' }]).chip).toBe('No consultado');
    expect(reputationInfo().chip).toBe('Sin datos');
  });
});
