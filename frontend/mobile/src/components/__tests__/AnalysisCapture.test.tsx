import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AnalysisCapture } from '../AnalysisCapture';

jest.mock('../../lib/session', () => ({
  apiUrl: (path: string) => `https://api.example.test/api/v1${path}`,
}));

const attemptId = '0b9a8f1e-3c2d-4e5f-8a7b-1c2d3e4f5a6b';

describe('AnalysisCapture', () => {
  it('pide la captura a la API con el token de la sesión', async () => {
    await render(<AnalysisCapture attemptId={attemptId} accessToken="token-123" />);
    const image = screen.getByTestId('analysis-capture-image');
    expect(image.props.source).toEqual(expect.objectContaining({
      uri: `https://api.example.test/api/v1/analyses/${attemptId}/capture`,
      headers: { Authorization: 'Bearer token-123' },
    }));
  });

  it('oculta la sección cuando no hay captura (404 u otro error)', async () => {
    await render(<AnalysisCapture attemptId={attemptId} accessToken="token-123" />);
    await act(async () => { fireEvent(screen.getByTestId('analysis-capture-image'), 'error'); });
    expect(screen.queryByTestId('analysis-capture')).toBeNull();
  });

  it('quita el indicador de carga cuando la imagen llega', async () => {
    await render(<AnalysisCapture attemptId={attemptId} accessToken="token-123" />);
    await act(async () => { fireEvent(screen.getByTestId('analysis-capture-image'), 'load'); });
    expect(screen.getByText('Captura del sitio')).toBeTruthy();
    expect(screen.queryByTestId('analysis-capture-loading')).toBeNull();
  });
});
