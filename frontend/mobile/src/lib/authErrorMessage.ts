import type { SessionError } from './session';

function asSessionError(cause: unknown): SessionError {
  return cause instanceof Error ? cause as SessionError : {} as SessionError;
}

function isNetworkError(error: SessionError): boolean {
  return error.code === 'NETWORK_ERROR';
}

export function loginErrorMessage(cause: unknown): string {
  const error = asSessionError(cause);
  if (error.status === 401) return 'El correo o la contraseña no coinciden.';
  if (error.status === 429) return 'Se alcanzó el límite de intentos. Espera un momento antes de volver a intentarlo.';
  if (error.status === 400) return 'Revisa los datos e inténtalo de nuevo.';
  if (isNetworkError(error)) return 'No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.';
  return 'No se pudo iniciar sesión. Inténtalo de nuevo más tarde.';
}

export function registerErrorMessage(cause: unknown): string {
  const error = asSessionError(cause);
  if (error.status === 409) return 'Ya existe una cuenta con este correo.';
  if (error.status === 400) return 'Revisa el correo y la contraseña e inténtalo de nuevo.';
  if (error.status === 429) return 'Se alcanzó el límite de registros. Espera un momento antes de volver a intentarlo.';
  if (isNetworkError(error)) return 'No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.';
  return 'No se pudo crear la cuenta. Inténtalo de nuevo más tarde.';
}
