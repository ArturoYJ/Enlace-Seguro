import { Slot } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';
import { act, fireEvent } from '@testing-library/react-native';
import type { ReactNode } from 'react';

const mockSignIn = jest.fn();
const mockSignUp = jest.fn();

jest.mock('../../lib/session', () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => children,
  useSession: () => ({ signIn: mockSignIn, signUp: mockSignUp, sessionNotice: null }),
}));

function TestLayout() {
  return <Slot />;
}

describe('auth route errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('matches the approved Figma login field placeholders', async () => {
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/auth/login' },
    );

    expect(screen.getByPlaceholderText('tucorreo@ejemplo.com')).toBeTruthy();
    expect(screen.getByPlaceholderText('••••••••')).toBeTruthy();
  });

  it('shows the generic login throttle message after a real 429 response', async () => {
    mockSignIn.mockRejectedValue(Object.assign(new Error('Too many requests'), { status: 429 }));
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/auth/login' },
    );

    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'person@example.com');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'correct-horse-battery');
    await act(async () => { await fireEvent.press(screen.getByText('Iniciar sesión')); });

    expect(await screen.findByText('Se alcanzó el límite de intentos. Espera un momento antes de volver a intentarlo.')).toBeTruthy();
    expect(mockSignIn).toHaveBeenCalledWith('person@example.com', 'correct-horse-battery');
  });

  it('maps rejected login credentials to a generic credential message', async () => {
    mockSignIn.mockRejectedValue(Object.assign(new Error('Account lookup detail'), { status: 401 }));
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/auth/login' },
    );

    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'person@example.com');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'wrong-password');
    await act(async () => { await fireEvent.press(screen.getByText('Iniciar sesión')); });

    expect(await screen.findByText('El correo o la contraseña no coinciden.')).toBeTruthy();
    expect(screen.queryByText('Account lookup detail')).toBeNull();
  });

  it('maps login network failures to a retryable connection message', async () => {
    mockSignIn.mockRejectedValue(Object.assign(new Error('Internal fetch detail'), { code: 'NETWORK_ERROR' }));
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/auth/login' },
    );

    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'person@example.com');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'correct-horse-battery');
    await act(async () => { await fireEvent.press(screen.getByText('Iniciar sesión')); });

    expect(await screen.findByText('No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.')).toBeTruthy();
    expect(screen.queryByText('Internal fetch detail')).toBeNull();
  });

  it('shows an account-conflict message when registration returns 409', async () => {
    mockSignUp.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409 }));
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/auth/register' },
    );

    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'person@example.com');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'correct-horse-battery');
    await act(async () => { await fireEvent.press(screen.getByText('Crear cuenta')); });

    expect(await screen.findByText('Ya existe una cuenta con este correo.')).toBeTruthy();
    expect(mockSignUp).toHaveBeenCalledWith('person@example.com', 'correct-horse-battery');
  });

  it('maps registration validation errors without showing server details', async () => {
    mockSignUp.mockRejectedValue(Object.assign(new Error('Internal validation detail'), { status: 400 }));
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/auth/register' },
    );

    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'person@example.com');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'correct-horse-battery');
    await act(async () => { await fireEvent.press(screen.getByText('Crear cuenta')); });

    expect(await screen.findByText('Revisa el correo y la contraseña e inténtalo de nuevo.')).toBeTruthy();
    expect(screen.queryByText('Internal validation detail')).toBeNull();
  });

  it('maps unexpected registration failures to a safe generic message', async () => {
    mockSignUp.mockRejectedValue(Object.assign(new Error('Database connection string leaked'), { status: 500 }));
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/auth/register' },
    );

    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'person@example.com');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'correct-horse-battery');
    await act(async () => { await fireEvent.press(screen.getByText('Crear cuenta')); });

    expect(await screen.findByText('No se pudo crear la cuenta. Inténtalo de nuevo más tarde.')).toBeTruthy();
    expect(screen.queryByText('Database connection string leaked')).toBeNull();
  });

  it('maps malformed login and unexpected failures to safe messages', async () => {
    mockSignIn.mockRejectedValueOnce(Object.assign(new Error('Internal validation detail'), { status: 400 }));
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/auth/login' },
    );

    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'person@example.com');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'correct-horse-battery');
    await act(async () => { await fireEvent.press(screen.getByText('Iniciar sesión')); });

    expect(await screen.findByText('Revisa los datos e inténtalo de nuevo.')).toBeTruthy();
    expect(screen.queryByText('Internal validation detail')).toBeNull();
  });

  it('does not classify undocumented 422 responses as validation errors', async () => {
    mockSignUp.mockRejectedValue(Object.assign(new Error('Private validation detail'), { status: 422 }));
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/auth/register' },
    );

    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'person@example.com');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'correct-horse-battery');
    await act(async () => { await fireEvent.press(screen.getByText('Crear cuenta')); });

    expect(await screen.findByText('No se pudo crear la cuenta. Inténtalo de nuevo más tarde.')).toBeTruthy();
    expect(screen.queryByText('Private validation detail')).toBeNull();
  });

  it('maps registration throttling to a retry-later message', async () => {
    mockSignUp.mockRejectedValue(Object.assign(new Error('Internal throttle detail'), { status: 429 }));
    await renderRouter(
      { appDir: './src/app', overrides: { _layout: TestLayout } },
      { initialUrl: '/auth/register' },
    );

    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), 'person@example.com');
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'correct-horse-battery');
    await act(async () => { await fireEvent.press(screen.getByText('Crear cuenta')); });

    expect(await screen.findByText('Se alcanzó el límite de registros. Espera un momento antes de volver a intentarlo.')).toBeTruthy();
    expect(screen.queryByText('Internal throttle detail')).toBeNull();
  });
});
