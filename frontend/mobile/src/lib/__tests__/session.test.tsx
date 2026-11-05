import { Button, Text, View } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { SessionProvider, authenticatedRequest, useSession } from '../session';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AfterFirstUnlockThisDeviceOnly',
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const TOKEN_KEY = 'enlaceseguro.session.v1';
const pair = { accessToken: 'test-access-token', refreshToken: 'test-refresh-token', tokenType: 'Bearer' as const, expiresIn: 900 };
let storedCredential: string | null = null;

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function Probe() {
  const session = useSession();
  const signIn = () => { void session.signIn('person@example.test', 'password123').catch(() => undefined); };
  const signOut = () => { void session.signOut().catch(() => undefined); };
  const requestProfile = () => { void authenticatedRequest('/auth/me').catch(() => undefined); };
  const retryRestore = () => { void session.retrySessionRestore(); };
  return (
    <View>
      <Text testID="session-state">{JSON.stringify({ ready: session.ready, accessToken: session.accessToken, expired: session.sessionExpired, notice: session.sessionNotice, retryable: session.sessionRestoreRetryable, retrying: session.sessionRestorePending })}</Text>
      <Button title="Sign in" onPress={signIn} />
      <Button title="Sign out" onPress={signOut} />
      <Button title="Profile request" onPress={requestProfile} />
      <Button title="Retry restore" onPress={retryRestore} />
    </View>
  );
}

async function renderProbe() {
  return await render(<SessionProvider><Probe /></SessionProvider>);
}

describe('mobile session lifecycle', () => {
  const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>();
  const secureStore = SecureStore as jest.Mocked<typeof SecureStore>;

  beforeEach(() => {
    jest.clearAllMocks();
    storedCredential = null;
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true, configurable: true });
    secureStore.getItemAsync.mockImplementation(async () => storedCredential);
    secureStore.setItemAsync.mockImplementation(async (_key, value) => { storedCredential = value; });
    secureStore.deleteItemAsync.mockImplementation(async () => { storedCredential = null; });
  });

  it('stores only the rotated refresh token and keeps the access token in React memory', async () => {
    fetchMock.mockResolvedValueOnce(response(200, pair));
    const view = await renderProbe();
    await waitFor(() => expect(view.getByTestId('session-state').props.children).toContain('"ready":true'));

    await fireEvent.press(view.getByText('Sign in'));

    await waitFor(() => expect(view.getByTestId('session-state').props.children).toContain('test-access-token'));
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      TOKEN_KEY,
      JSON.stringify({ refreshToken: 'test-refresh-token' }),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  });

  it('retains the refresh token on a transient refresh network failure', async () => {
    secureStore.getItemAsync.mockResolvedValue(JSON.stringify({ refreshToken: 'saved-refresh-token' }));
    fetchMock.mockRejectedValueOnce(new Error('network failure')).mockResolvedValueOnce(response(200, pair));
    const view = await renderProbe();

    await waitFor(() => expect(view.getByTestId('session-state').props.children).toContain('No pudimos conectarnos'));
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(view.getByTestId('session-state').props.children).toContain('"accessToken":null');
    expect(view.getByTestId('session-state').props.children).toContain('"expired":false');
    expect(view.getByTestId('session-state').props.children).toContain('"retryable":true');

    await fireEvent.press(view.getByText('Retry restore'));
    await waitFor(() => expect(view.getByTestId('session-state').props.children).toContain('test-access-token'));
    expect(view.getByTestId('session-state').props.children).toContain('"retryable":false');
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('hides server details when refresh receives an unexpected HTTP failure', async () => {
    secureStore.getItemAsync.mockResolvedValue(JSON.stringify({ refreshToken: 'saved-refresh-token' }));
    fetchMock.mockResolvedValueOnce(response(500, { title: 'Internal error', detail: 'Database host and query leaked' }));
    const view = await renderProbe();

    await waitFor(() => expect(view.getByTestId('session-state').props.children).toContain('No pudimos validar tu sesión.'));
    expect(view.getByTestId('session-state').props.children).not.toContain('Database host and query leaked');
    expect(view.getByTestId('session-state').props.children).toContain('"retryable":true');
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('clears a refresh token rejected by the API', async () => {
    secureStore.getItemAsync.mockResolvedValue(JSON.stringify({ refreshToken: 'expired-refresh-token' }));
    fetchMock
      .mockResolvedValueOnce(response(401, { title: 'Unauthorized', detail: 'Token expired' }))
      .mockResolvedValueOnce(response(200, pair));
    const view = await renderProbe();

    await waitFor(() => expect(view.getByTestId('session-state').props.children).toContain('Tu sesión terminó'));
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
    expect(view.getByTestId('session-state').props.children).toContain('"accessToken":null');
    expect(view.getByTestId('session-state').props.children).toContain('"expired":true');
    expect(view.getByTestId('session-state').props.children).toContain('"retryable":false');
    await fireEvent.press(view.getByText('Sign in'));
    await waitFor(() => expect(view.getByTestId('session-state').props.children).toContain('"expired":false'));
  });

  it('clears a malformed credential from secure storage without making an API request', async () => {
    secureStore.getItemAsync.mockResolvedValue('{not-valid-json');
    const view = await renderProbe();

    await waitFor(() => expect(view.getByTestId('session-state').props.children).toContain('"ready":true'));

    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(view.getByTestId('session-state').props.children).toContain('Tu sesión terminó');
    expect(view.getByTestId('session-state').props.children).toContain('"accessToken":null');
    expect(view.getByTestId('session-state').props.children).toContain('"expired":false');
  });

  it('updates the React session when a protected request and refresh both return 401', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, pair))
      .mockResolvedValueOnce(response(401, { title: 'Unauthorized' }))
      .mockResolvedValueOnce(response(401, { title: 'Unauthorized' }));
    const view = await renderProbe();
    await waitFor(() => expect(view.getByTestId('session-state').props.children).toContain('"ready":true'));
    await fireEvent.press(view.getByText('Sign in'));
    await waitFor(() => expect(view.getByTestId('session-state').props.children).toContain('test-access-token'));

    await fireEvent.press(view.getByText('Profile request'));

    await waitFor(() => expect(view.getByTestId('session-state').props.children).toContain('Tu sesión terminó'));
    expect(view.getByTestId('session-state').props.children).toContain('"accessToken":null');
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
  });

  it('clears the local session even if remote logout cannot be confirmed', async () => {
    fetchMock.mockResolvedValueOnce(response(200, pair)).mockRejectedValueOnce(new Error('offline'));
    const view = await renderProbe();
    await waitFor(() => expect(view.getByTestId('session-state').props.children).toContain('"ready":true'));
    await fireEvent.press(view.getByText('Sign in'));
    await waitFor(() => expect(view.getByTestId('session-state').props.children).toContain('test-access-token'));

    await fireEvent.press(view.getByText('Sign out'));

    await waitFor(() => expect(view.getByTestId('session-state').props.children).toContain('no pudimos confirmar su revocación'));
    expect(view.getByTestId('session-state').props.children).toContain('"accessToken":null');
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY);
  });
});
