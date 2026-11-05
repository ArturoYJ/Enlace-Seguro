import { Slot } from 'expo-router';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { act, fireEvent } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import * as Clipboard from 'expo-clipboard';
import { authenticatedRequest } from '../../lib/session';

jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn() }));

jest.mock('../../lib/session', () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({ ready: true, accessToken: 'test-token', signOut: jest.fn() }),
  authenticatedRequest: jest.fn(),
}));

function TestLayout() {
  return <Slot />;
}

describe('analysis URL flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Clipboard.getStringAsync as jest.Mock).mockResolvedValue('');
    (globalThis.fetch as jest.Mock) = jest.fn();
    (authenticatedRequest as jest.Mock).mockImplementation(() => new Promise(() => undefined));
  });


  it('reads clipboard only after the explicit paste action and fills the local message field', async () => {
    (Clipboard.getStringAsync as jest.Mock).mockResolvedValue('Aviso privado: https://example.test/revisar');
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );

    expect(Clipboard.getStringAsync).not.toHaveBeenCalled();
    await act(async () => { await fireEvent.press(screen.getByLabelText('Pegar enlace o mensaje del portapapeles')); });

    expect(Clipboard.getStringAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Enlace o mensaje para analizar').props.value).toBe('Aviso privado: https://example.test/revisar');
  });

  it.each([
    ['empty', '', 'El portapapeles está vacío. Copia un enlace o mensaje y vuelve a intentarlo.'],
    ['overlong', 'x'.repeat(481), 'El texto supera el límite de 480 caracteres. Pega solo el enlace o un fragmento más corto.'],
  ])('does not populate the input from %s clipboard content', async (_caseName, clipboardText, expectedMessage) => {
    (Clipboard.getStringAsync as jest.Mock).mockResolvedValue(clipboardText);
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );
    if (_caseName === 'overlong') {
      await fireEvent.changeText(screen.getByLabelText('Enlace o mensaje para analizar'), 'https://example.test/previous');
    }

    await act(async () => { await fireEvent.press(screen.getByLabelText('Pegar enlace o mensaje del portapapeles')); });

    expect(await screen.findByText(expectedMessage)).toBeTruthy();
    expect(screen.getByLabelText('Enlace o mensaje para analizar').props.value).toBe('');
  });

  it('rejects an overlong manual paste instead of truncating it silently', async () => {
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );
    const input = screen.getByLabelText('Enlace o mensaje para analizar');
    await fireEvent.changeText(input, 'https://example.test/previous');
    await fireEvent.changeText(input, 'https://example.test/'.padEnd(481, 'x'));

    expect(await screen.findByText('El texto supera el límite de 480 caracteres.')).toBeTruthy();
    expect(screen.getByLabelText('Enlace o mensaje para analizar').props.value).toBe('');
    expect(screen.getByLabelText('Enlace o mensaje para analizar').props.maxLength).toBeUndefined();

    await act(async () => { await fireEvent.press(screen.getByText('Analizar enlace')); });
    expect(authenticatedRequest).not.toHaveBeenCalledWith('/analyses', expect.anything());
  });

  it('keeps manual input available when clipboard access fails', async () => {
    (Clipboard.getStringAsync as jest.Mock).mockRejectedValue(new Error('Clipboard unavailable'));
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );

    await act(async () => { await fireEvent.press(screen.getByLabelText('Pegar enlace o mensaje del portapapeles')); });

    expect(await screen.findByText('No pudimos leer el portapapeles. También puedes pegar el enlace en el campo.')).toBeTruthy();
    expect(screen.getByLabelText('Enlace o mensaje para analizar').props.value).toBe('');
  });

  it('rejects unsupported URL schemes before sending an analysis request', async () => {
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );
    await fireEvent.changeText(screen.getByLabelText('Enlace o mensaje para analizar'), 'javascript:alert(1)');
    await act(async () => { await fireEvent.press(screen.getByText('Analizar enlace')); });

    expect(await screen.findByText('Incluye un enlace que comience con http:// o https://.')).toBeTruthy();
    expect(authenticatedRequest).not.toHaveBeenCalledWith('/analyses', expect.anything());
  });

  it('extracts a single URL from a message and sends only that URL to the API', async () => {
    let profileCalls = 0;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => {
      if (path === '/auth/me') {
        profileCalls += 1;
        if (profileCalls === 1) return new Promise(() => undefined);
        return Promise.resolve({ user: { email: 'test@example.test' }, quota: { remaining: 4, limit: 5 } });
      }
      if (path === '/analyses/summary' || path === '/analyses?limit=3') return new Promise(() => undefined);
      if (path === '/analyses') return Promise.resolve({ attemptId: 'attempt-message', localDate: '2026-11-04', processingStatus: 'received' });
      if (path.startsWith('/analyses/attempt-message?')) return new Promise(() => undefined);
      throw new Error(`Unexpected request: ${path}`);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );
    const privateMessage = 'Tu cuenta fue bloqueada. Revisa https://example.test/acceso?ref=synthetic.';
    await fireEvent.changeText(screen.getByLabelText('Enlace o mensaje para analizar'), privateMessage);
    expect(screen.getByText(`${privateMessage.length} / 480`)).toBeTruthy();

    await act(async () => { await fireEvent.press(screen.getByText('Analizar enlace')); });

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith('/analyses', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ input: 'https://example.test/acceso?ref=synthetic' }),
    })));
    const submittedBody = (authenticatedRequest as jest.Mock).mock.calls.find(([path, init]) => path === '/analyses' && init?.method === 'POST')?.[1]?.body;
    expect(submittedBody).not.toContain('Tu cuenta fue bloqueada');
    expect(submittedBody).not.toContain(privateMessage);
  });

  it.each([
    ['no URL', 'Tu cuenta necesita atención.', 'Incluye un enlace que comience con http:// o https://.'],
    ['multiple URLs', 'Compara https://first.example y https://second.example', 'El mensaje contiene varios enlaces. Deja solo uno para analizarlo.'],
  ])('does not submit a message with %s', async (_caseName, input, expectedMessage) => {
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );
    await fireEvent.changeText(screen.getByLabelText('Enlace o mensaje para analizar'), input);
    await act(async () => { await fireEvent.press(screen.getByText('Analizar enlace')); });

    expect(await screen.findByText(expectedMessage)).toBeTruthy();
    expect(authenticatedRequest).not.toHaveBeenCalledWith('/analyses', expect.anything());
  });

  it('clears the local message and counter without sending a request', async () => {
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );
    await fireEvent.changeText(screen.getByLabelText('Enlace o mensaje para analizar'), 'https://example.test/private');
    await fireEvent.press(screen.getByLabelText('Borrar texto'));

    expect(screen.getByLabelText('Enlace o mensaje para analizar').props.value).toBe('');
    expect(screen.getByText('0 / 480')).toBeTruthy();
    expect(authenticatedRequest).not.toHaveBeenCalledWith('/analyses', expect.anything());
  });

  it('matches Figma bottom tabs and keeps account reachable from the profile action', async () => {
    const route = await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );

    expect(screen.getByLabelText('Inicio')).toBeTruthy();
    expect(screen.getByLabelText('Analizar')).toBeTruthy();
    expect(screen.getByLabelText('Historial')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Mi cuenta'));
    await waitFor(() => expect(route.getPathname()).toBe('/account'));
  });

  it('loads recent analyses from the API and renders only sanitized hosts', async () => {
    const items = [
      { attemptId: 'a1', localDate: '2026-11-04', receivedAt: '2026-11-04T15:00:00.000Z', processingStatus: 'completed', submittedInput: 'https://news.example/private?token=secret', analysis: { verdict: 'sospechoso' } },
      { attemptId: 'a2', localDate: '2026-11-04', receivedAt: '2026-11-04T14:00:00.000Z', processingStatus: 'processing', submittedInput: 'https://shop.example/cart?session=private' },
      { attemptId: 'a3', localDate: '2026-11-04', receivedAt: '2026-11-04T13:00:00.000Z', processingStatus: 'failed', submittedInput: 'https://mail.example/reset?token=private' },
      { attemptId: 'a4', localDate: '2026-11-04', receivedAt: '2026-11-04T12:00:00.000Z', processingStatus: 'completed', submittedInput: 'https://fourth.example/' },
    ];
    let resolveRecent: ((value: unknown) => void) | undefined;
    let resolveRecentDetail: ((value: unknown) => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return new Promise(() => undefined);
      if (path === '/analyses/summary') return new Promise(() => undefined);
      if (path === '/analyses?limit=3') return new Promise((resolve) => { resolveRecent = resolve; });
      if (path.startsWith('/analyses/a1?')) return new Promise((resolve) => { resolveRecentDetail = resolve; });
      throw new Error(`Unexpected request: ${path}`);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );

    await waitFor(() => expect(resolveRecent).toBeDefined());
    await act(async () => {
      resolveRecent?.({ items, hasMore: true, nextCursor: 'cursor' });
      await Promise.resolve();
    });

    expect(await screen.findByText('news.example')).toBeTruthy();
    expect(screen.getByText('shop.example')).toBeTruthy();
    expect(screen.getByText('mail.example')).toBeTruthy();
    expect(screen.queryByText('fourth.example')).toBeNull();
    expect(screen.getByText('Sospechoso')).toBeTruthy();
    expect(screen.getByText('En análisis')).toBeTruthy();
    expect(screen.getByTestId('recent-icon-a1')).toBeTruthy();
    expect(screen.getByTestId('recent-badge-a1')).toBeTruthy();
    expect(screen.getByTestId('recent-icon-a2')).toBeTruthy();
    expect(screen.queryByText(/private|secret/)).toBeNull();
    expect(authenticatedRequest).toHaveBeenCalledWith('/analyses?limit=3', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await fireEvent.press(screen.getByLabelText(/Análisis de news.example/));
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith('/analyses/a1?localDate=2026-11-04', expect.objectContaining({ signal: expect.any(AbortSignal) })));
    await waitFor(() => expect(resolveRecentDetail).toBeDefined());
    await act(async () => {
      resolveRecentDetail?.({ attemptId: 'a1', localDate: '2026-11-04', receivedAt: '2026-11-04T15:00:00.000Z', processingStatus: 'completed', analysis: { verdict: 'sospechoso', reasons: [] } });
      await Promise.resolve();
    });
  });

  it('shows recent-list errors with retry while keeping the analysis form available', async () => {
    let attempts = 0;
    (authenticatedRequest as jest.Mock).mockImplementation(async (path: string) => {
      if (path === '/auth/me') return new Promise(() => undefined);
      if (path === '/analyses/summary') return new Promise(() => undefined);
      if (path === '/analyses?limit=3') {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error('Database address leaked'), { status: 500 });
        return { items: [], hasMore: false, nextCursor: null };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );

    expect(await screen.findByText('No pudimos cargar tus análisis recientes.')).toBeTruthy();
    expect(screen.queryByText('Database address leaked')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Enlace o mensaje para analizar')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByText('Reintentar'));
      await Promise.resolve();
    });
    expect(await screen.findByText('Tus análisis aparecerán aquí.')).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it('announces recent-list loading while showing decorative skeleton rows', async () => {
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => {
      if (path === '/auth/me' || path === '/analyses/summary' || path === '/analyses?limit=3') return new Promise(() => undefined);
      throw new Error(`Unexpected request: ${path}`);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );

    const loading = await screen.findByRole('progressbar');
    expect(loading.props.accessibilityLabel).toBe('Cargando análisis recientes');
    expect(loading.props.accessibilityState).toEqual({ busy: true });
    expect(screen.getByTestId('analysis-recent-skeletons', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('Cargando análisis…')).toBeTruthy();
  });

  it('shows quota loading while the account request is pending', async () => {
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => {
      if (path === '/auth/me' || path === '/analyses/summary' || path === '/analyses?limit=3') return new Promise(() => undefined);
      throw new Error(`Unexpected request: ${path}`);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );

    expect(screen.getByLabelText('Cargando cuota de análisis')).toBeTruthy();
  });

  it('shows a safe quota error and retry control when the account request fails', async () => {
    (authenticatedRequest as jest.Mock).mockImplementation(async (path: string) => {
      if (path === '/auth/me') throw new Error('temporary profile outage');
      if (path === '/analyses/summary' || path === '/analyses?limit=3') return new Promise(() => undefined);
      throw new Error(`Unexpected request: ${path}`);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );

    expect(await screen.findByText('La cuota no está disponible temporalmente.')).toBeTruthy();
    expect(screen.getByLabelText('Enlace o mensaje para analizar')).toBeTruthy();
    expect(screen.getByLabelText('Reintentar cuota')).toBeTruthy();
    expect(screen.queryByText('temporary profile outage')).toBeNull();
  });

  it('explains a real 429 quota response without fabricating an analysis result', async () => {
    (authenticatedRequest as jest.Mock).mockImplementation(async (path: string) => {
      if (path === '/auth/me' || path === '/analyses/summary' || path === '/analyses?limit=3') return new Promise(() => undefined);
      const error = new Error('Too many requests') as Error & { status: number };
      error.status = 429;
      throw error;
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );
    await fireEvent.changeText(screen.getByLabelText('Enlace o mensaje para analizar'), 'https://example.com/path');
    await act(async () => { await fireEvent.press(screen.getByText('Analizar enlace')); });

    expect(await screen.findByText('Límite de análisis alcanzado')).toBeTruthy();
    expect(screen.getByText(/Alcanzaste la cuota diaria de análisis de tu cuenta/)).toBeTruthy();
    expect(screen.queryByText('Análisis completado')).toBeNull();
    expect(authenticatedRequest).toHaveBeenCalledWith('/analyses', expect.objectContaining({ method: 'POST' }));
  });

  it('keeps the submitted URL available and shows a connection error when admission fails offline', async () => {
    (authenticatedRequest as jest.Mock).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/auth/me') return new Promise(() => undefined);
      if (path === '/analyses/summary') return new Promise(() => undefined);
      if (path === '/analyses?limit=3') return new Promise(() => undefined);
      if (path === '/analyses' && init?.method === 'POST') {
        throw Object.assign(new Error('No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.'), { code: 'NETWORK_ERROR' });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );
    const submittedUrl = 'https://example.com/private?token=keep-local';
    await fireEvent.changeText(screen.getByLabelText('Enlace o mensaje para analizar'), submittedUrl);
    await act(async () => { await fireEvent.press(screen.getByText('Analizar enlace')); });

    expect(await screen.findByText('Sin conexión')).toBeTruthy();
    expect(screen.getByText(/el texto permanece en el campo/)).toBeTruthy();
    expect(screen.getByDisplayValue(submittedUrl)).toBeTruthy();
    expect(screen.queryByText('Análisis completado')).toBeNull();
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledTimes(4)); // profile + metrics + recent list + failed admission; no retry POST
  });

  it('uses a safe fallback when analysis admission returns an unexpected server error', async () => {
    (authenticatedRequest as jest.Mock).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/auth/me' || path === '/analyses/summary' || path === '/analyses?limit=3') return new Promise(() => undefined);
      if (path === '/analyses' && init?.method === 'POST') {
        throw Object.assign(new Error('Internal database host leaked'), { status: 500 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );
    await fireEvent.changeText(screen.getByLabelText('Enlace o mensaje para analizar'), 'https://example.test/path');
    await act(async () => { await fireEvent.press(screen.getByText('Analizar enlace')); });

    expect(await screen.findByText('No pudimos iniciar el análisis. Inténtalo de nuevo más tarde.')).toBeTruthy();
    expect(screen.queryByText('Internal database host leaked')).toBeNull();
    expect(screen.getByDisplayValue('https://example.test/path')).toBeTruthy();
  });

  it('renders the server verdict and its safety caveat after polling completes', async () => {
    let meCalls = 0;
    let resolveAdmission: ((value: unknown) => void) | undefined;
    let resolveDetail: ((value: unknown) => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/auth/me') {
        meCalls += 1;
        if (meCalls === 1) return new Promise(() => undefined);
        return Promise.resolve({ user: { email: 'test@example.com' }, quota: { remaining: 4, limit: 5, resetAt: '2026-11-04T06:00:00.000Z' } });
      }
      if (path === '/analyses/summary') return new Promise(() => undefined);
      if (path === '/analyses?limit=3') return new Promise(() => undefined);
      if (path === '/analyses' && init?.method === 'POST') return new Promise((resolve) => { resolveAdmission = resolve; });
      if (path.startsWith('/analyses/attempt-1?')) return new Promise((resolve) => { resolveDetail = resolve; });
      throw new Error(`Unexpected request: ${path}`);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );

    await fireEvent.changeText(screen.getByLabelText('Enlace o mensaje para analizar'), 'https://example.com/safe-path');
    await act(async () => {
      fireEvent.press(screen.getByText('Analizar enlace'));
      expect(resolveAdmission).toBeDefined();
      resolveAdmission?.({ attemptId: 'attempt-1', localDate: '2026-11-03', processingStatus: 'received' });
      await Promise.resolve();
    });
    await waitFor(() => expect(resolveDetail).toBeDefined());
    await act(async () => {
      resolveDetail?.({
        attemptId: 'attempt-1',
        localDate: '2026-11-03',
        receivedAt: '2026-11-03T18:00:00.000Z',
        processingStatus: 'completed',
        analysis: { verdict: 'sin_amenazas_detectadas', reasons: ['No se observaron señales de riesgo.'], signals: [] },
      });
    });

    expect(screen.getByText('Sin amenazas detectadas')).toBeTruthy();
    expect(screen.getByText('No se detectaron amenazas en este análisis. Esto no garantiza que el sitio sea seguro.')).toBeTruthy();
    expect(authenticatedRequest).toHaveBeenCalledWith(expect.stringMatching(/^\/analyses\/attempt-1\?localDate=/), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('shows an inconclusive TLS result without inventing a verdict', async () => {
    let meCalls = 0;
    (authenticatedRequest as jest.Mock).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/auth/me') {
        meCalls += 1;
        if (meCalls === 1) return new Promise(() => undefined);
        return { user: { email: 'test@example.com' }, quota: { remaining: 4, limit: 5, resetAt: '2026-11-04T06:00:00.000Z' } };
      }
      if (path === '/analyses/summary') return new Promise(() => undefined);
      if (path === '/analyses?limit=3') return new Promise(() => undefined);
      if (path === '/analyses' && init?.method === 'POST') return { attemptId: 'attempt-tls', localDate: '2026-11-03', processingStatus: 'received' };
      if (path.startsWith('/analyses/attempt-tls?')) return {
        attemptId: 'attempt-tls', localDate: '2026-11-03', processingStatus: 'inconclusive'
      };
      throw new Error(`Unexpected request: ${path}`);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );
    await fireEvent.changeText(screen.getByLabelText('Enlace o mensaje para analizar'), 'https://invalid-cert.example');
    await act(async () => { await fireEvent.press(screen.getByText('Analizar enlace')); });

    await waitFor(() => expect(screen.getByText('Resultado no concluyente')).toBeTruthy());
    expect(screen.getByText(/No hubo evidencia suficiente para emitir un veredicto/)).toBeTruthy();
    expect(screen.queryByText('Sin amenazas detectadas')).toBeNull();
    expect(screen.queryByText('Peligroso')).toBeNull();
  });

  it('shows validation_failed as a separate non-verdict state', async () => {
    let resolveDetail: ((value: unknown) => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => {
      if (path.startsWith('/analyses/attempt-validation?')) return new Promise((resolve) => { resolveDetail = resolve; });
      return new Promise(() => undefined);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis/attempt-validation?localDate=2026-11-04' },
    );
    await waitFor(() => expect(resolveDetail).toBeDefined());
    await act(async () => {
      resolveDetail?.({
        attemptId: 'attempt-validation',
        localDate: '2026-11-04',
        receivedAt: '2026-11-04T15:00:00.000Z',
        processingStatus: 'validation_failed',
        submittedInput: 'https://example.test/invalid?secret=hidden',
      });
    });

    expect(await screen.findByText('No se pudo validar el enlace')).toBeTruthy();
    expect(screen.getByText('La solicitud no superó la validación. No se presentó un veredicto.')).toBeTruthy();
    expect(screen.getByText('example.test')).toBeTruthy();
    expect(screen.queryByText(/invalid\?|secret=hidden/)).toBeNull();
    expect(screen.queryByText('Sin amenazas detectadas')).toBeNull();
    expect(screen.queryByText('Peligroso')).toBeNull();
  });

  it('shows a safe detail-load error without rendering raw server details', async () => {
    let rejectDetail: ((reason: Error) => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => {
      if (path.startsWith('/analyses/attempt-private?')) {
        return new Promise((_, reject) => { rejectDetail = reject; });
      }
      return new Promise(() => undefined);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis/attempt-private?localDate=2026-11-04' },
    );
    await waitFor(() => expect(rejectDetail).toBeDefined());
    await act(async () => {
      rejectDetail?.(Object.assign(new Error('Mongo host and internal query leaked'), { status: 500 }));
    });

    expect(await screen.findByText('No pudimos cargar este análisis. Inténtalo de nuevo más tarde.')).toBeTruthy();
    expect(screen.queryByText('Mongo host and internal query leaked')).toBeNull();
    expect(screen.getByText('Volver a intentar')).toBeTruthy();
  });

  it('keeps missing and cross-owner detail responses indistinguishable', async () => {
    let rejectDetail: ((reason: Error) => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => {
      if (path.startsWith('/analyses/attempt-other-owner?')) {
        return new Promise((_, reject) => { rejectDetail = reject; });
      }
      return new Promise(() => undefined);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis/attempt-other-owner?localDate=2026-11-04' },
    );
    await waitFor(() => expect(rejectDetail).toBeDefined());
    await act(async () => {
      rejectDetail?.(Object.assign(new Error('Attempt belongs to another account'), { status: 404 }));
    });

    expect(await screen.findByText('No encontramos este análisis o ya no está disponible.')).toBeTruthy();
    expect(screen.queryByText('Attempt belongs to another account')).toBeNull();
  });

  it('shows dedicated processing progress and hides private URL components', async () => {
    let resolveProgress: ((value: unknown) => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => {
      if (path.startsWith('/analyses/attempt-progress?')) return new Promise((resolve) => { resolveProgress = resolve; });
      if (path === '/auth/me' || path === '/analyses?limit=3' || path === '/analyses/summary') return new Promise(() => undefined);
      throw new Error(`Unexpected request: ${path}`);
    });
    const route = await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis/attempt-progress?localDate=2026-11-04' },
    );
    await waitFor(() => expect(resolveProgress).toBeDefined());
    await act(async () => {
      resolveProgress?.({
        attemptId: 'attempt-progress', localDate: '2026-11-04', receivedAt: new Date().toISOString(),
        processingStatus: 'processing', submittedInput: 'https://example.test/private?token=secret',
      });
      await Promise.resolve();
    });

    expect(await screen.findByText('Revisando el enlace')).toBeTruthy();
    expect(screen.getByText('Recibido')).toBeTruthy();
    expect(screen.getByText('En fila')).toBeTruthy();
    expect(screen.getAllByText('Analizando').length).toBeGreaterThan(0);
    expect(screen.getByText('example.test')).toBeTruthy();
    expect(screen.queryByText(/private|secret/)).toBeNull();
    await fireEvent.press(screen.getByText('Seguir en segundo plano'));
    await waitFor(() => expect(route.getPathname()).toBe('/analysis'));
  });

  it('renders real dangerous-result reasons without exposing URL paths or inventing reputation sources', async () => {
    let resolveDetail: ((value: unknown) => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string) => {
      if (path.startsWith('/analyses/attempt-danger?')) return new Promise((resolve) => { resolveDetail = resolve; });
      throw new Error(`Unexpected request: ${path}`);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis/attempt-danger?localDate=2026-11-04' },
    );
    await waitFor(() => expect(resolveDetail).toBeDefined());
    await act(async () => {
      resolveDetail?.({
        attemptId: 'attempt-danger', localDate: '2026-11-04', receivedAt: '2026-11-04T15:00:00.000Z',
        completedAt: '2026-11-04T15:00:15.000Z', processingStatus: 'completed',
        submittedInput: 'https://phishing.example/login?token=private',
        analysis: { verdict: 'peligroso', reasons: ['El análisis observó un formulario de acceso sospechoso.'], signals: ['login_form_detected'], sourceResults: [] },
      });
      await Promise.resolve();
    });

    expect(await screen.findByText('Peligroso')).toBeTruthy();
    expect(screen.getByText('phishing.example')).toBeTruthy();
    expect(screen.getByText(/formulario de acceso sospechoso/)).toBeTruthy();
    expect(screen.queryByText(/private|login_form_detected|Google Safe Browsing|VirusTotal/)).toBeNull();
    expect(screen.getByText('Analizar otro enlace')).toBeTruthy();
    expect(screen.getByText('Ver en historial')).toBeTruthy();
    expect(screen.queryByText('Captura')).toBeNull();
  });

  it('only retries a failed analysis after explicit action and discloses the new quota request', async () => {
    const request = authenticatedRequest as jest.Mock;
    let resolveInitial: ((value: unknown) => void) | undefined;
    let resolveRetry: ((value: unknown) => void) | undefined;
    let resolveRetryDetail: ((value: unknown) => void) | undefined;
    request.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/analyses/attempt-failed?localDate=2026-11-04') return new Promise((resolve) => { resolveInitial = resolve; });
      if (path === '/analyses' && init?.method === 'POST') return new Promise((resolve) => { resolveRetry = resolve; });
      if (path.startsWith('/analyses/attempt-retry?')) return new Promise((resolve) => { resolveRetryDetail = resolve; });
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis/attempt-failed?localDate=2026-11-04' },
    );
    await waitFor(() => expect(resolveInitial).toBeDefined());
    await act(async () => {
      resolveInitial?.({
        attemptId: 'attempt-failed', localDate: '2026-11-04', receivedAt: '2026-11-04T15:00:00.000Z',
        processingStatus: 'failed', submittedInput: 'https://example.test/path?token=private',
      });
      await Promise.resolve();
    });

    expect(await screen.findByText('No se pudo analizar')).toBeTruthy();
    expect(screen.getByText('El análisis no terminó correctamente. No se presentó un veredicto.')).toBeTruthy();
    expect(screen.getByText('El reintento crea una nueva solicitud y puede consumir cuota.')).toBeTruthy();
    expect(request.mock.calls.filter(([path, init]) => path === '/analyses' && init?.method === 'POST')).toHaveLength(0);
    await fireEvent.press(screen.getByText('Intentar de nuevo'));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/analyses', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ input: 'https://example.test/path?token=private' }),
    })));
    await waitFor(() => expect(resolveRetry).toBeDefined());
    await act(async () => {
      resolveRetry?.({ attemptId: 'attempt-retry', localDate: '2026-11-04', processingStatus: 'received' });
      await Promise.resolve();
    });
    await waitFor(() => expect(resolveRetryDetail).toBeDefined());
    await act(async () => {
      resolveRetryDetail?.({
        attemptId: 'attempt-retry', localDate: '2026-11-04', receivedAt: new Date().toISOString(), processingStatus: 'processing',
      });
      await Promise.resolve();
    });
    expect(await screen.findByText('Revisando el enlace')).toBeTruthy();
  });

  it('loads real personal metrics and labels every count with its period', async () => {
    let resolveSummary: ((value: unknown) => void) | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation(async (path: string) => {
      if (path === '/auth/me' || path === '/analyses?limit=3') return new Promise(() => undefined);
      if (path === '/analyses/summary') return new Promise((resolve) => { resolveSummary = resolve; });
      throw new Error(`Unexpected request: ${path}`);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );

    expect(await screen.findByText('Cargando métricas…')).toBeTruthy();
    await waitFor(() => expect(resolveSummary).toBeDefined());
    await act(async () => {
      resolveSummary?.({
        window: { startsAtInclusive: '2025-11-05T12:00:00.000Z', endsAtExclusive: '2026-11-04T12:00:00.000Z' },
        total: 12,
        dangerous: 2,
        suspicious: 5
      });
      await Promise.resolve();
    });

    expect(screen.getByText('Últimos 365 días')).toBeTruthy();
    expect(screen.getByLabelText('Analizados, 12, últimos 365 días')).toBeTruthy();
    expect(screen.getByLabelText('Peligrosos, 2, últimos 365 días')).toBeTruthy();
    expect(screen.getByLabelText('Sospechosos, 5, últimos 365 días')).toBeTruthy();
    expect(screen.queryByText('18')).toBeNull();
  });

  it('lets the user retry metric errors and shows genuine zero counts', async () => {
    let requests = 0;
    (authenticatedRequest as jest.Mock).mockImplementation(async (path: string) => {
      if (path === '/auth/me' || path === '/analyses?limit=3') return new Promise(() => undefined);
      if (path === '/analyses/summary') {
        requests += 1;
        if (requests === 1) throw Object.assign(new Error('Internal metrics query leaked'), { status: 500 });
        return {
          window: { startsAtInclusive: '2025-11-05T12:00:00.000Z', endsAtExclusive: '2026-11-04T12:00:00.000Z' },
          total: 0,
          dangerous: 0,
          suspicious: 0
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );

    expect(await screen.findByText('No pudimos cargar tus métricas.')).toBeTruthy();
    expect(screen.queryByText('Internal metrics query leaked')).toBeNull();
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Reintentar carga de métricas'));
      await Promise.resolve();
    });
    expect(await screen.findByText('Sin análisis en este período.')).toBeTruthy();
    expect(screen.getByLabelText('Analizados, 0, últimos 365 días')).toBeTruthy();
    expect(screen.getByLabelText('Peligrosos, 0, últimos 365 días')).toBeTruthy();
    expect(screen.getByLabelText('Sospechosos, 0, últimos 365 días')).toBeTruthy();
    expect(requests).toBe(2);
  });

  it('aborts an in-flight personal-summary request when the screen unmounts', async () => {
    let summarySignal: AbortSignal | undefined;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/analyses/summary') {
        summarySignal = init?.signal as AbortSignal;
        return new Promise(() => undefined);
      }
      if (path === '/auth/me' || path === '/analyses?limit=3') return new Promise(() => undefined);
      throw new Error(`Unexpected request: ${path}`);
    });

    const screenView = await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );
    await waitFor(() => expect(summarySignal).toBeDefined());
    await act(async () => { screenView.unmount(); });
    expect(summarySignal?.aborted).toBe(true);
  });

  it('ignores stale metrics when a newly admitted analysis triggers a newer summary request', async () => {
    let summaryCalls = 0;
    const summarySignals: AbortSignal[] = [];
    const summaryResolvers: ((value: unknown) => void)[] = [];
    let profileCalls = 0;
    (authenticatedRequest as jest.Mock).mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/auth/me') {
        profileCalls += 1;
        if (profileCalls === 1) return new Promise(() => undefined);
        return Promise.resolve({ user: { email: 'test@example.test' }, quota: { remaining: 4, limit: 5, resetAt: '2026-11-04T06:00:00.000Z' } });
      }
      if (path === '/analyses?limit=3') return new Promise(() => undefined);
      if (path === '/analyses/summary') {
        summaryCalls += 1;
        summarySignals.push(init?.signal as AbortSignal);
        return new Promise((resolve) => { summaryResolvers.push(resolve); });
      }
      if (path === '/analyses' && init?.method === 'POST') return Promise.resolve({ attemptId: 'attempt-new', localDate: '2026-11-04', processingStatus: 'received' });
      if (path.startsWith('/analyses/attempt-new?')) return Promise.resolve({ attemptId: 'attempt-new', localDate: '2026-11-04', processingStatus: 'completed', analysis: { verdict: 'sospechoso', reasons: [] } });
      throw new Error(`Unexpected request: ${path}`);
    });

    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/analysis' },
    );
    await waitFor(() => expect(summaryCalls).toBe(1));
    await fireEvent.changeText(screen.getByLabelText('Enlace o mensaje para analizar'), 'https://example.test/path');
    await act(async () => { await fireEvent.press(screen.getByText('Analizar enlace')); });
    await waitFor(() => expect(summaryCalls).toBe(2));
    expect(summarySignals[0]?.aborted).toBe(true);

    await act(async () => {
      summaryResolvers[0]?.({ window: { startsAtInclusive: 'old', endsAtExclusive: 'old' }, total: 1, dangerous: 1, suspicious: 0 });
      summaryResolvers[1]?.({ window: { startsAtInclusive: 'new', endsAtExclusive: 'new' }, total: 22, dangerous: 4, suspicious: 3 });
      await Promise.resolve();
    });
    await fireEvent.press(screen.getByLabelText('Volver al inicio'));
    await waitFor(() => expect(summaryCalls).toBe(3));
    await act(async () => {
      summaryResolvers[2]?.({ window: { startsAtInclusive: 'new', endsAtExclusive: 'new' }, total: 22, dangerous: 4, suspicious: 3 });
      await Promise.resolve();
    });
    expect(await screen.findByLabelText('Analizados, 22, últimos 365 días')).toBeTruthy();
    expect(screen.queryByLabelText('Analizados, 1, últimos 365 días')).toBeNull();
  });
});
