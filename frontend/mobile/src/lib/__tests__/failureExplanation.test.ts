import { failureExplanation } from '../failureExplanation';
import { analysisPresentation } from '../analysisPresentation';

describe('failureExplanation', () => {
  it('explica en lenguaje sencillo por qué no hubo veredicto', () => {
    expect(failureExplanation('site_unreachable').title).toBe('El sitio no respondió');
    expect(failureExplanation('dns_unavailable').title).toBe('Esa dirección no existe');
    expect(failureExplanation('tls_invalid').title).toBe('La conexión segura no es válida');
  });

  it('solo sugiere reintentar cuando tiene sentido', () => {
    expect(failureExplanation('site_unreachable').retryUseful).toBe(false);
    expect(failureExplanation('service_busy').retryUseful).toBe(true);
  });

  it('usa una explicación genérica si la razón es desconocida o no llegó', () => {
    expect(failureExplanation(undefined).title).toBe('No pudimos terminar la revisión');
    expect(failureExplanation('algo_nuevo').title).toBe('No pudimos terminar la revisión');
  });

  it('el historial muestra la razón corta en lugar de "Error"', () => {
    expect(analysisPresentation({ processingStatus: 'failed', failureReason: 'site_unreachable' }).label).toBe('No respondió');
    expect(analysisPresentation({ processingStatus: 'failed' }).label).toBe('Error');
  });
});
