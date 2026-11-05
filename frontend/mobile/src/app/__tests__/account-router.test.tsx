import { Slot } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { authenticatedRequest } from '../../lib/session';

let mockAccessToken: string | null = 'test-token';
let mockSessionExpired = false;
const mockSignOut = jest.fn<Promise<void>, []>();
jest.mock('../../lib/session', () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({ ready: true, accessToken: mockAccessToken, sessionExpired: mockSessionExpired, sessionNotice: null, signOut: mockSignOut }),
  authenticatedRequest: jest.fn(),
}));

function TestLayout() {
  return <Slot />;
}

describe('account route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccessToken = 'test-token';
    mockSessionExpired = false;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => path === '/analyses/summary'
      ? new Promise(() => undefined)
      : Promise.resolve({
        user: { id: 'user-1', email: 'person@example.test', accountStatus: 'active', createdAt: '2026-01-04T12:00:00.000Z' },
        quota: { remaining: 3, limit: 5, used: 2, resetAt: '2026-11-04T06:00:00.000Z' },
      }));
  });

  it('lets the user retry a failed profile request and then shows the account', async () => {
    let rejectProfile: ((error: Error) => void) | undefined;
    let resolveRetry: ((profile: unknown) => void) | undefined;
    let profileCalls = 0;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => {
      if (path === '/analyses/summary') return new Promise(() => undefined);
      profileCalls += 1;
      if (profileCalls === 1) return new Promise((_resolve, reject) => { rejectProfile = reject; });
      return new Promise((resolve) => { resolveRetry = resolve; });
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/account' },
    );
    expect(screen.getByRole('progressbar', { name: 'Cargando tu cuenta' })).toBeTruthy();
    expect(screen.getByTestId('account-skeleton', { includeHiddenElements: true })).toBeTruthy();
    await act(async () => {
      rejectProfile?.(Object.assign(new Error('fetch failed'), { code: 'NETWORK_ERROR' }));
      await Promise.resolve();
    });

    expect(await screen.findByText('No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Volver a intentar'));
    await waitFor(() => expect(resolveRetry).toBeDefined());
    await act(async () => {
      resolveRetry?.({
        user: { id: 'user-1', email: 'person@example.test', accountStatus: 'active', createdAt: '2026-01-04T12:00:00.000Z' },
        quota: { remaining: 3, limit: 5, used: 2, resetAt: '2026-11-04T06:00:00.000Z' },
      });
      await Promise.resolve();
    });
    expect(await screen.findByText('person@example.test')).toBeTruthy();
    expect(screen.getByText('Últimos 365 días')).toBeTruthy();
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledTimes(3));
  });

  it('does not show internal details when profile loading fails', async () => {
    let rejectProfile: ((error: Error) => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => {
      if (path === '/analyses/summary') return new Promise(() => undefined);
      return new Promise((_resolve, reject) => { rejectProfile = reject; });
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/account' },
    );
    await waitFor(() => expect(rejectProfile).toBeDefined());
    await act(async () => {
      rejectProfile?.(Object.assign(new Error('Mongo host and profile query'), { status: 500 }));
    });

    expect(await screen.findByText('No pudimos cargar tu cuenta. Inténtalo de nuevo.')).toBeTruthy();
    expect(screen.queryByText('Mongo host and profile query')).toBeNull();
  });

  it('routes a protected account page to a dedicated session-expired screen after refresh is rejected', async () => {
    mockAccessToken = null;
    mockSessionExpired = true;
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/account' },
    );

    expect(await screen.findByText('Tu sesión expiró')).toBeTruthy();
    expect(authenticatedRequest).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Iniciar sesión'));
    expect(await screen.findByText('Inicia sesión')).toBeTruthy();
  });

  it('opens and closes the development-only design-system showcase from account', async () => {
    let resolveProfile: ((profile: unknown) => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => path === '/analyses/summary'
      ? new Promise(() => undefined)
      : new Promise((resolve) => { resolveProfile = resolve; }));
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/account' },
    );

    await act(async () => {
      resolveProfile?.({
        user: { id: 'user-1', email: 'person@example.test', accountStatus: 'active', createdAt: '2026-01-04T12:00:00.000Z' },
        quota: { remaining: 3, limit: 5, used: 2, resetAt: '2026-11-04T06:00:00.000Z' },
      });
      await Promise.resolve();
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Abrir showcase del sistema de diseño' }));
    expect(await screen.findByRole('header', { name: 'Sistema de diseño' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar showcase del sistema de diseño' }));
    await waitFor(() => expect(screen.queryByRole('header', { name: 'Sistema de diseño' })).toBeNull());
  });

  it('loads only real summary counts, retries summary errors, and shows valid zero counts', async () => {
    let summaryCalls = 0;
    let resolveProfile: ((profile: unknown) => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => {
      if (path === '/analyses/summary') {
        summaryCalls += 1;
        return summaryCalls === 1
          ? Promise.reject(new Error('temporary failure'))
          : Promise.resolve({ total: 0, dangerous: 0, suspicious: 0 });
      }
      return new Promise((resolve) => { resolveProfile = resolve; });
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/account' },
    );

    await waitFor(() => expect(resolveProfile).toBeDefined());
    await act(async () => {
      resolveProfile?.({
        user: { id: 'user-1', email: 'person@example.test', accountStatus: 'active', createdAt: '2026-01-04T12:00:00.000Z' },
        quota: { remaining: 5, limit: 5, used: 0, resetAt: '2026-11-04T06:00:00.000Z' },
      });
      await Promise.resolve();
    });

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('No pudimos cargar tus estadísticas.')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText('Volver a intentar'));
      await Promise.resolve();
    });
    expect(await screen.findAllByText('0')).toHaveLength(3);
    expect(screen.getByText('Solicitudes')).toBeTruthy();
    expect(screen.getByText('El total incluye solicitudes en cualquier estado; peligrosos y sospechosos requieren veredicto registrado.')).toBeTruthy();
    expect(summaryCalls).toBe(2);
    expect(screen.queryByText('18')).toBeNull();
    expect(screen.queryByText('Carlos Rafael Ruiz Ruiz')).toBeNull();
  });

  it('requires explicit confirmation before logging out and lets the user cancel', async () => {
    let resolveProfile: ((profile: unknown) => void) | undefined;
    let resolveLogout: (() => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => path === '/analyses/summary'
      ? new Promise(() => undefined)
      : new Promise((resolve) => { resolveProfile = resolve; }));
    mockSignOut.mockImplementationOnce(() => new Promise((resolve) => { resolveLogout = resolve; }));
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/account' },
    );
    await waitFor(() => expect(resolveProfile).toBeDefined());
    await act(async () => {
      resolveProfile?.({
      user: { id: 'user-1', email: 'person@example.test', accountStatus: 'active', createdAt: '2026-01-04T12:00:00.000Z' },
      quota: { remaining: 3, limit: 5, used: 2, resetAt: '2026-11-04T06:00:00.000Z' },
      });
      await Promise.resolve();
    });
    expect(await screen.findByText('person@example.test')).toBeTruthy();
    expect(await screen.findByText('Miembro desde enero de 2026')).toBeTruthy();

    await fireEvent.press(screen.getByText('Cerrar sesión'));
    expect(screen.getByText('¿Cerrar sesión?')).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Cancelar'));
    expect(screen.queryByText('¿Cerrar sesión?')).toBeNull();
    expect(mockSignOut).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Cerrar sesión'));
    await fireEvent.press(screen.getByLabelText('Confirmar cierre de sesión'));
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
      expect(resolveLogout).toBeDefined();
    });
    await act(async () => {
      resolveLogout?.();
      await Promise.resolve();
    });
    expect(await screen.findByText('Inicia sesión')).toBeTruthy();
  });
});
