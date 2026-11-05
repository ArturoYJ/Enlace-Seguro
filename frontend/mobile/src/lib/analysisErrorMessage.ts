import { safeApiErrorMessage } from './safeApiErrorMessage';

type ApiError = Error & { status?: number; code?: string };

function asApiError(cause: unknown): ApiError {
  return cause instanceof Error ? cause as ApiError : {} as ApiError;
}

export function analysisDetailErrorMessage(cause: unknown): string {
  const error = asApiError(cause);
  if (error.status === 404) return 'No encontramos este análisis o ya no está disponible.';
  if (error.status === 400) return 'No pudimos validar la solicitud. Revisa el historial e inténtalo de nuevo.';
  return safeApiErrorMessage(error, 'No pudimos cargar este análisis. Inténtalo de nuevo más tarde.');
}
