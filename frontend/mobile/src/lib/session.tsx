import * as SecureStore from 'expo-secure-store';
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { safeApiErrorMessage } from './safeApiErrorMessage';

const TOKEN_KEY = 'enlaceseguro.session.v1';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

type TokenPair = { accessToken: string; refreshToken: string; tokenType: 'Bearer'; expiresIn: number };
type ApiProblem = { title?: string; detail?: string; status?: number; type?: string };
export type SessionError = Error & { status?: number; code?: string };
type RefreshOutcome = { accessToken: string | null; error?: SessionError; invalid: boolean; expired?: boolean };
type SessionContextValue = {
  accessToken: string | null;
  ready: boolean;
  userEmail: string | null;
  sessionExpired: boolean;
  sessionNotice: string | null;
  sessionRestoreRetryable: boolean;
  sessionRestorePending: boolean;
  retrySessionRestore: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);
const expirationListeners = new Set<(expired: boolean) => void>();
let activeAccessToken: string | null = null;
let refreshInFlight: Promise<RefreshOutcome> | null = null;

function apiUrl(path: string): string {
  if (!API_BASE_URL) throw new Error('Configura EXPO_PUBLIC_API_URL con la URL base de la API (incluye /api/v1).');
  return `${API_BASE_URL}${path}`;
}

async function request<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(apiUrl(path), { ...init, headers });
  } catch {
    const error = new Error('No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.') as SessionError;
    error.code = 'NETWORK_ERROR';
    throw error;
  }
  if (!response.ok) {
    let problem: ApiProblem = {};
    try { problem = await response.json() as ApiProblem; } catch { /* use generic message */ }
    const error = new Error(problem.detail || problem.title || 'No fue posible completar la solicitud.') as SessionError;
    error.status = response.status;
    error.code = problem.type?.split('/').pop();
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

async function storePair(pair: TokenPair): Promise<void> {
  if (Platform.OS === 'web') throw new Error('El acceso seguro está disponible en la aplicación móvil.');
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify({ refreshToken: pair.refreshToken }), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  activeAccessToken = pair.accessToken;
}

async function clearPair(): Promise<void> {
  activeAccessToken = null;
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function clearPairBestEffort(): Promise<void> {
  try { await clearPair(); } catch { activeAccessToken = null; }
}

function publishExpiration(expired = false): void {
  activeAccessToken = null;
  for (const listener of expirationListeners) listener(expired);
  void clearPair().catch(() => undefined);
}

async function refreshSession(): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    if (Platform.OS === 'web') return { accessToken: null, invalid: false };
    let raw: string | null;
    try { raw = await SecureStore.getItemAsync(TOKEN_KEY); }
    catch { return { accessToken: null, error: new Error('No pudimos acceder a la sesión segura del dispositivo.'), invalid: false }; }
    if (!raw) return { accessToken: null, invalid: false };

    let savedRefreshToken: string;
    try {
      const stored = JSON.parse(raw) as { refreshToken?: unknown };
      if (typeof stored.refreshToken !== 'string' || stored.refreshToken.length === 0) throw new Error('Invalid stored session');
      savedRefreshToken = stored.refreshToken;
    } catch {
      await clearPairBestEffort();
      return { accessToken: null, invalid: true };
    }

    let pair: TokenPair;
    try {
      pair = await request<TokenPair>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: savedRefreshToken }) });
    } catch (cause) {
      const error = cause as SessionError;
      if (error.status === 401 || error.status === 403) {
        await clearPairBestEffort();
        return { accessToken: null, invalid: true, expired: true };
      }
      // Transient network/server failures do not destroy the user's still-unverified refresh credential.
      return { accessToken: null, error, invalid: false };
    }
    try { await storePair(pair); }
    catch {
      // Rotation already consumed the previous token; never keep that now-stale value after a secure-store write failure.
      await clearPairBestEffort();
      return { accessToken: null, error: new Error('No pudimos guardar la sesión segura. Inicia sesión de nuevo.'), invalid: true };
    }
    return { accessToken: pair.accessToken, invalid: false };
  })();
  try { return await refreshInFlight; }
  finally { refreshInFlight = null; }
}

function expiredError(): SessionError {
  const error = new Error('Tu sesión expiró. Inicia sesión para continuar.') as SessionError;
  error.status = 401;
  return error;
}

async function requireFreshToken(outcome: RefreshOutcome): Promise<string> {
  if (outcome.accessToken) return outcome.accessToken;
  if (outcome.invalid || !outcome.error) publishExpiration(outcome.expired ?? false);
  if (outcome.error) throw outcome.error;
  throw expiredError();
}

export async function authenticatedRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let token = activeAccessToken;
  if (!token) token = await requireFreshToken(await refreshSession());
  try {
    return await request<T>(path, init, token);
  } catch (error) {
    if ((error as SessionError).status !== 401) throw error;
    token = await requireFreshToken(await refreshSession());
    try {
      return await request<T>(path, init, token);
    } catch (retryError) {
      if ((retryError as SessionError).status === 401) {
        publishExpiration(true);
        throw expiredError();
      }
      throw retryError;
    }
  }
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [sessionRestoreRetryable, setSessionRestoreRetryable] = useState(false);
  const [sessionRestorePending, setSessionRestorePending] = useState(false);
  const retryingRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    activeAccessToken = null;
    const onExpiration = (expired: boolean) => {
      if (mounted) {
        setAccessToken(null);
        setSessionExpired(expired);
        setSessionNotice('Tu sesión terminó. Inicia sesión para continuar.');
        setSessionRestoreRetryable(false);
        setReady(true);
      }
    };
    expirationListeners.add(onExpiration);
    void refreshSession().then((outcome) => {
      if (!mounted) return;
      setAccessToken(outcome.accessToken);
      setSessionExpired(outcome.expired ?? false);
      setSessionNotice(outcome.error
        ? safeApiErrorMessage(outcome.error, 'No pudimos validar tu sesión. Revisa tu conexión e inténtalo de nuevo.')
        : (outcome.invalid ? 'Tu sesión terminó. Inicia sesión para continuar.' : null));
      setSessionRestoreRetryable(Boolean(outcome.error && !outcome.invalid));
      setReady(true);
    }).catch(() => {
      if (mounted) {
        setSessionNotice('No pudimos validar tu sesión. Revisa tu conexión e inténtalo de nuevo.');
        setSessionRestoreRetryable(true);
        setReady(true);
      }
    });
    return () => { mounted = false; expirationListeners.delete(onExpiration); };
  }, []);

  const retrySessionRestore = useCallback(async () => {
    if (retryingRef.current || !sessionRestoreRetryable) return;
    retryingRef.current = true;
    setSessionRestorePending(true);
    setSessionNotice(null);
    try {
      const outcome = await refreshSession();
      setAccessToken(outcome.accessToken);
      setSessionExpired(outcome.expired ?? false);
      setSessionNotice(outcome.error
        ? safeApiErrorMessage(outcome.error, 'No pudimos validar tu sesión. Revisa tu conexión e inténtalo de nuevo.')
        : (outcome.invalid ? 'Tu sesión terminó. Inicia sesión para continuar.' : null));
      setSessionRestoreRetryable(Boolean(outcome.error && !outcome.invalid));
      if (outcome.invalid || !outcome.error && !outcome.accessToken) {
        setSessionExpired(outcome.expired ?? false);
      }
    } catch {
      setSessionNotice('No pudimos validar tu sesión. Revisa tu conexión e inténtalo de nuevo.');
      setSessionRestoreRetryable(true);
    } finally {
      retryingRef.current = false;
      setSessionRestorePending(false);
    }
  }, [sessionRestoreRetryable]);

  const signIn = useCallback(async (email: string, password: string) => {
    const pair = await request<TokenPair>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    await storePair(pair);
    setAccessToken(pair.accessToken);
    setUserEmail(email);
    setSessionExpired(false);
    setSessionNotice(null);
    setSessionRestoreRetryable(false);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    await request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
  }, []);

  const signOut = useCallback(async () => {
    let remoteFailure = false;
    try {
      if (Platform.OS !== 'web') {
        const raw = await SecureStore.getItemAsync(TOKEN_KEY);
        const stored = raw ? JSON.parse(raw) as { refreshToken?: string } : {};
        if (stored.refreshToken) await request('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: stored.refreshToken }) });
      }
    } catch { remoteFailure = true; }
    finally {
      try { await clearPair(); } catch { activeAccessToken = null; }
      setAccessToken(null);
      setUserEmail(null);
      setSessionExpired(false);
      setSessionNotice(remoteFailure ? 'Se cerró la sesión en este dispositivo, pero no pudimos confirmar su revocación en el servidor.' : null);
      setSessionRestoreRetryable(false);
    }
    if (remoteFailure) throw new Error('La sesión local se cerró, pero no pudimos confirmar la revocación con el servidor.');
  }, []);

  const value = useMemo(() => ({ accessToken, ready, userEmail, sessionExpired, sessionNotice, sessionRestoreRetryable, sessionRestorePending, retrySessionRestore, signIn, signUp, signOut }), [accessToken, ready, userEmail, sessionExpired, sessionNotice, sessionRestoreRetryable, sessionRestorePending, retrySessionRestore, signIn, signUp, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession debe usarse dentro de SessionProvider.');
  return value;
}
