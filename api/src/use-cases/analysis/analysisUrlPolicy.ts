/**
 * Regla única de qué se acepta para analizar: un solo enlace http(s) limpio.
 * La app ya extrae el enlace del mensaje pegado, pero la API no puede confiar en el cliente:
 * alguien puede llamar a la API directamente con cualquier texto. Por eso se valida aquí también.
 */
export const MAX_ANALYSIS_URL_LENGTH = 2048;

// Caracteres que nunca aparecen sin codificar en un enlace válido y que se usan para inyectar
// HTML, JavaScript o comandos: < > " ' ` { } | \ ^ y espacios o caracteres de control.
const FORBIDDEN_CHARACTERS = /[\s<>"'`{}|\\^\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/u;
const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type AnalysisUrlProblem =
  | 'too_long' | 'forbidden_characters' | 'not_a_url' | 'unsupported_scheme' | 'credentials_not_allowed' | 'invalid_host';

export function checkAnalysisUrl(value: string): { ok: true; url: string } | { ok: false; problem: AnalysisUrlProblem } {
  if (value.length > MAX_ANALYSIS_URL_LENGTH) return { ok: false, problem: 'too_long' };
  if (FORBIDDEN_CHARACTERS.test(value)) return { ok: false, problem: 'forbidden_characters' };
  // Solo se aceptan enlaces escritos con su esquema; así "javascript:", "data:", "file:" o un
  // comando suelto nunca llegan a parecer un enlace.
  if (!/^https?:\/\//i.test(value)) return { ok: false, problem: 'unsupported_scheme' };
  let parsed: URL;
  try { parsed = new URL(value); } catch { return { ok: false, problem: 'not_a_url' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, problem: 'unsupported_scheme' };
  if (parsed.username || parsed.password) return { ok: false, problem: 'credentials_not_allowed' };
  const host = parsed.hostname.toLowerCase();
  const isIpv6 = host.startsWith('[') && host.endsWith(']');
  if (!host || host.length > 253 || (!isIpv6 && !HOSTNAME.test(host.replace(/\.$/, '')))) {
    return { ok: false, problem: 'invalid_host' };
  }
  return { ok: true, url: value };
}
