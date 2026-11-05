import { AccessibilityInfo } from 'react-native';
import { renderHook } from '@testing-library/react-native';
import { useAnalysisStatusAnnouncement, type AnalysisStatusAnnouncement } from '../useAnalysisStatusAnnouncement';

const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => undefined);

const snapshot = (overrides: Partial<AnalysisStatusAnnouncement> = {}): AnalysisStatusAnnouncement => ({
  attemptId: 'attempt-1',
  status: 'received',
  verdict: undefined,
  message: 'Análisis recibido.',
  ...overrides,
});

describe('useAnalysisStatusAnnouncement', () => {
  beforeEach(() => announce.mockClear());

  afterAll(() => announce.mockRestore());

  it('announces only meaningful transitions once and resets deduplication for a new attempt', async () => {
    const initial = snapshot();
    const { rerender } = await renderHook(
      ({ current }: { current: AnalysisStatusAnnouncement }) => useAnalysisStatusAnnouncement(current),
      { initialProps: { current: initial } },
    );

    expect(announce).not.toHaveBeenCalled();

    const processing = snapshot({ status: 'processing', message: 'El análisis sigue en curso.' });
    await rerender({ current: processing });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('El análisis sigue en curso.', { queue: true, priority: 'low' });

    await rerender({ current: { ...processing } });
    expect(announce).toHaveBeenCalledTimes(1);

    const nextAttempt = snapshot({ attemptId: 'attempt-2', status: 'processing', message: 'El análisis sigue en curso.' });
    await rerender({ current: nextAttempt });
    expect(announce).toHaveBeenCalledTimes(1);

    const dangerous = snapshot({
      attemptId: 'attempt-2',
      status: 'completed',
      verdict: 'peligroso',
      message: 'Resultado del análisis: Peligroso. Evita abrir este enlace.',
    });
    await rerender({ current: dangerous });
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith(dangerous.message, { queue: true, priority: 'low' });
    expect(dangerous.message).not.toMatch(/https?:\/\//i);

    await rerender({ current: { ...dangerous } });
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['failed', 'No se pudo completar el análisis.'],
    ['validation_failed', 'No se pudo validar el enlace.'],
    ['inconclusive', 'Resultado no concluyente; no se emitió veredicto. No es garantía de seguridad.'],
  ])('announces terminal status %s without fabricating a verdict', async (status, message) => {
    const { rerender } = await renderHook(
      ({ current }: { current: AnalysisStatusAnnouncement }) => useAnalysisStatusAnnouncement(current),
      { initialProps: { current: snapshot({ status: 'processing', message: 'El análisis sigue en curso.' }) } },
    );

    await rerender({ current: snapshot({ status, message }) });

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(message, { queue: true, priority: 'low' });
    expect(announce).not.toHaveBeenCalledWith(expect.stringMatching(/Sin amenazas detectadas|Peligroso|Sospechoso/), expect.anything());
  });
});
