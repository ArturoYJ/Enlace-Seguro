import { Slot } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { authenticatedRequest } from '../../lib/session';
import { colors } from '../../theme/tokens';

let mockAccessToken: string | null = 'test-token';
jest.mock('../../lib/session', () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({ ready: true, accessToken: mockAccessToken, sessionNotice: null, signIn: jest.fn() }),
  authenticatedRequest: jest.fn(),
}));

function TestLayout() {
  return <Slot />;
}

const item = (attemptId: string, submittedInput: string) => ({
  attemptId,
  localDate: '2026-11-03',
  receivedAt: '2026-11-03T18:30:00.000Z',
  processingStatus: 'completed',
  submittedInput,
  analysis: { verdict: 'sospechoso', reasons: ['Se observó una redirección.'] },
});

describe('history cursor navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAccessToken = 'test-token';
  });

  it.each(['/history', '/account'])('redirects a signed-out user away from %s to login', async (initialUrl) => {
    mockAccessToken = null;
    const route = await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl },
    );

    await waitFor(() => expect(route.getPathname()).toBe('/auth/login'));
    expect(screen.getByText('Inicia sesión')).toBeTruthy();
    expect(authenticatedRequest).not.toHaveBeenCalled();
  });

  it('shows a connection failure and allows a manual history retry', async () => {
    let resolveRetry: ((page: { items: []; hasMore: boolean; nextCursor: null }) => void) | undefined;
    (authenticatedRequest as jest.Mock)
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { code: 'NETWORK_ERROR' }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/history' },
    );

    expect(await screen.findByText('No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByText('Volver a intentar'));
    expect(resolveRetry).toBeDefined();
    await act(async () => { resolveRetry?.({ items: [], hasMore: false, nextCursor: null }); });

    expect(await screen.findByText('Aún no tienes análisis')).toBeTruthy();
    expect(authenticatedRequest).toHaveBeenCalledTimes(2);
  });

  it('hides server details when history loading fails with an HTTP error', async () => {
    let rejectPage: ((error: Error) => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation(() => new Promise((_resolve, reject) => { rejectPage = reject; }));

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/history' },
    );
    await waitFor(() => expect(rejectPage).toBeDefined());
    await act(async () => {
      rejectPage?.(Object.assign(new Error('Mongo connection target leaked'), { status: 500 }));
    });

    expect(await screen.findByText('No pudimos cargar tu historial.')).toBeTruthy();
    expect(screen.queryByText('Mongo connection target leaked')).toBeNull();
  });

  it('announces history loading while showing decorative skeleton cards', async () => {
    (authenticatedRequest as jest.Mock).mockImplementation(() => new Promise(() => undefined));

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/history' },
    );

    const loading = await screen.findByRole('progressbar');
    expect(loading.props.accessibilityLabel).toBe('Cargando historial');
    expect(loading.props.accessibilityState).toEqual({ busy: true });
    expect(screen.getByTestId('history-skeletons', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('Cargando historial…')).toBeTruthy();
  });

  it('uses semantic icon and badge from each real verdict or processing status', async () => {
    const rows = [
      { ...item('attempt-danger', 'https://danger.example/private'), analysis: { verdict: 'peligroso' } },
      { ...item('attempt-warning', 'https://warning.example/private'), analysis: { verdict: 'sospechoso' } },
      { ...item('attempt-safe', 'https://safe.example/private'), analysis: { verdict: 'sin_amenazas_detectadas' } },
      { ...item('attempt-pending', 'https://pending.example/private'), processingStatus: 'processing', analysis: undefined },
      { ...item('attempt-inconclusive', 'https://inconclusive.example/private'), processingStatus: 'inconclusive', analysis: undefined },
    ];
    let resolvePage: ((page: unknown) => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation(() => new Promise((resolve) => { resolvePage = resolve; }));

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/history' },
    );
    await waitFor(() => expect(resolvePage).toBeDefined());
    await act(async () => {
      resolvePage?.({ items: rows, hasMore: false, nextCursor: null });
      await Promise.resolve();
    });

    for (const [attemptId, label, icon, color] of [
      ['attempt-danger', 'Peligroso', '!', colors.danger],
      ['attempt-warning', 'Sospechoso', '!', colors.warning],
      ['attempt-safe', 'Sin amenazas detectadas', '✓', colors.success],
      ['attempt-inconclusive', 'No concluyente', '?', colors.textSecondary],
    ]) {
      expect(await screen.findByTestId(`history-badge-${attemptId}`)).toBeTruthy();
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByTestId(`history-symbol-${attemptId}`).props.children).toBe(icon);
      expect(screen.getByTestId(`history-icon-${attemptId}`).props.style).toEqual(
        expect.arrayContaining([expect.objectContaining({ borderColor: color })]),
      );
    }
    expect(screen.getByTestId('history-spinner-attempt-pending')).toBeTruthy();
    expect(screen.getByText('En análisis')).toBeTruthy();
    expect(screen.getByTestId('history-icon-attempt-pending').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ borderColor: colors.primaryText })]),
    );
    expect(screen.queryByText(/private/)).toBeNull();
  });

  it('loads the next cursor page without displaying submitted URL paths or query data', async () => {
    let resolveFirstPage: ((value: unknown) => void) | undefined;
    let resolveSecondPage: ((value: unknown) => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => new Promise((resolve) => {
      if (path.includes('cursor=cursor-next')) resolveSecondPage = resolve;
      else resolveFirstPage = resolve;
    }));

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/history' },
    );

    await waitFor(() => expect(resolveFirstPage).toBeDefined());
    await act(async () => {
      resolveFirstPage?.({ items: [item('attempt-1', 'https://first.example/private?token=secret')], hasMore: true, nextCursor: 'cursor-next' });
      await Promise.resolve();
    });
    expect(await screen.findByText('first.example')).toBeTruthy();
    expect(screen.queryByText(/private|secret/)).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByText('Cargar más'));
      expect(resolveSecondPage).toBeDefined();
      resolveSecondPage?.({ items: [item('attempt-2', 'https://second.example/path?private=secret')], hasMore: false, nextCursor: null });
      await Promise.resolve();
    });

    expect(await screen.findByText('second.example')).toBeTruthy();
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith('/analyses?limit=10&cursor=cursor-next', expect.any(Object)));
    expect(screen.queryByText(/private|secret/)).toBeNull();
    expect(screen.getAllByText('Sospechoso').length).toBe(2);
  });
});
