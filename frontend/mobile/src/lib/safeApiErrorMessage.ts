type ApiErrorLike = { code?: unknown };

const NETWORK_ERROR_CODE = 'NETWORK_ERROR';
const NETWORK_ERROR_MESSAGE = 'No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.';

function apiErrorCode(cause: unknown): unknown {
  if (typeof cause !== 'object' || cause === null) return undefined;
  return (cause as ApiErrorLike).code;
}

export function safeApiErrorMessage(cause: unknown, fallback: string): string {
  return apiErrorCode(cause) === NETWORK_ERROR_CODE ? NETWORK_ERROR_MESSAGE : fallback;
}
