import { Slot } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { fireEvent } from '@testing-library/react-native';
import type { ReactNode } from 'react';

let mockSessionExpired = false;
let mockSessionNotice: string | null = null;
let mockSessionRestoreRetryable = false;
const mockRetrySessionRestore = jest.fn();
jest.mock('../../lib/session', () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({ ready: true, accessToken: null, sessionExpired: mockSessionExpired, sessionNotice: mockSessionNotice, sessionRestoreRetryable: mockSessionRestoreRetryable, sessionRestorePending: false, retrySessionRestore: mockRetrySessionRestore }),
}));

function TestLayout() {
  return <Slot />;
}

describe('onboarding navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionExpired = false;
    mockSessionNotice = null;
    mockSessionRestoreRetryable = false;
    mockRetrySessionRestore.mockReset();
    (globalThis.fetch as jest.Mock) = jest.fn();
  });

  it('shows the three welcome steps and routes to login when started', async () => {
    const route = await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/' },
    );

    expect(screen.getByText('¿Te llegó un enlace sospechoso?')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Pantalla 1 de 3' }).props.accessibilityValue).toEqual({
      min: 1,
      max: 3,
      now: 1,
    });
    await fireEvent.press(screen.getByText('Continuar'));
    expect(screen.getByText('Lo revisamos por ti')).toBeTruthy();
    await fireEvent.press(screen.getByText('Continuar'));
    expect(screen.getByText('Recibe un resultado fácil de entender')).toBeTruthy();
    await fireEvent.press(screen.getByText('Comenzar'));
    expect(route.getPathname()).toBe('/auth/login');
    expect(screen.getByText('Inicia sesión')).toBeTruthy();
  });

  it('shows the session-expired flow instead of onboarding when a saved session is rejected', async () => {
    mockSessionExpired = true;
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/' },
    );

    expect(await screen.findByText('Tu sesión expiró')).toBeTruthy();
  });

  it('offers a manual retry only for a transient session-restore failure', async () => {
    mockSessionNotice = 'No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.';
    mockSessionRestoreRetryable = true;
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/' },
    );
    expect(screen.getByText(mockSessionNotice)).toBeTruthy();
    await fireEvent.press(screen.getByText('Reintentar sesión'));
    expect(mockRetrySessionRestore).toHaveBeenCalledTimes(1);
  });
});
