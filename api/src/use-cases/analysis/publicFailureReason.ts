/**
 * Traduce el código interno con el que terminó un análisis fallido o no concluyente a una
 * categoría pública. No se exponen los códigos internos (nombres de servicios, estados HTTP),
 * solo lo que la persona necesita para entender qué pasó.
 */
export type PublicFailureReason =
  | 'site_unreachable'
  | 'site_too_slow'
  | 'dns_unavailable'
  | 'tls_invalid'
  | 'too_heavy'
  | 'page_unreadable'
  | 'service_busy'
  | 'service_error';

export function publicFailureReason(code: string | undefined): PublicFailureReason {
  switch (code) {
    case 'sandbox_http_502': return 'site_unreachable';
    case 'sandbox_http_504':
    case 'sandbox_timeout': return 'site_too_slow';
    case 'dns_unavailable': return 'dns_unavailable';
    case 'tls_certificate_invalid': return 'tls_invalid';
    case 'resource_limit_exceeded': return 'too_heavy';
    case 'dom_inspection_failed': return 'page_unreadable';
    case 'sandbox_http_503':
    case 'sandbox_rate_limited': return 'service_busy';
    default: return 'service_error';
  }
}
