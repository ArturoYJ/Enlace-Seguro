import { AntiSsrfGuard } from './AntiSsrfGuard.js';

/**
 * Señales que se obtienen solo de la URL, sin cargar la página.
 *
 * Son heurísticas: no prueban que un sitio sea malicioso, pero son patrones
 * frecuentes en campañas de smishing y phishing. VerdictEvaluator decide cómo
 * pesan, solas o combinadas con lo que el navegador observó en la página.
 */

// Extensiones con alta proporción de abuso en reportes públicos de phishing.
// Lista corta a propósito: cada extensión agregada aumenta los falsos positivos.
const SUSPICIOUS_TLDS = new Set([
  'zip', 'mov', 'xyz', 'top', 'click', 'link', 'live', 'buzz', 'cfd', 'sbs',
  'rest', 'icu', 'cyou', 'monster', 'quest', 'lol', 'tk', 'ml', 'ga', 'cf', 'gq'
]);

// Sufijos de dos niveles en los que el dominio registrable tiene tres etiquetas.
const TWO_LEVEL_SUFFIXES = new Set([
  'com.mx', 'gob.mx', 'org.mx', 'edu.mx', 'net.mx',
  'co.uk', 'com.ar', 'com.br', 'com.co', 'com.es'
]);

// Marcas que suelen suplantarse en mensajes a usuarios en México. Cada una se
// compara como palabra completa dentro del nombre del host.
const IMPERSONATED_BRANDS = new Set([
  'paypal', 'apple', 'icloud', 'microsoft', 'outlook', 'office365', 'google', 'gmail',
  'netflix', 'amazon', 'facebook', 'instagram', 'whatsapp',
  'bbva', 'banorte', 'santander', 'banamex', 'citibanamex', 'hsbc', 'scotiabank',
  'banregio', 'inbursa', 'bancoazteca', 'coppel', 'nubank',
  'mercadolibre', 'mercadopago', 'telcel', 'dhl', 'fedex', 'estafeta',
  'correosdemexico', 'sat', 'imss', 'infonavit', 'cfe'
]);

export interface UrlHeuristicResult {
  signals: string[];
  reasons: string[];
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith('[');
}

/** Devuelve la parte del dominio que se compra (ej. "bbva.mx", "sat.gob.mx"). */
export function registrableDomain(hostname: string): string {
  // Una IP no tiene dominio registrable: se compara completa.
  if (isIpLiteral(hostname)) return hostname;
  const labels = hostname.split('.');
  if (labels.length <= 2) return hostname;
  const lastTwo = labels.slice(-2).join('.');
  const take = TWO_LEVEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join('.');
}

export function analyzeUrl(url: string): UrlHeuristicResult {
  const signals: string[] = [];
  const reasons: string[] = [];
  const hostname = hostnameOf(url);
  if (!hostname) return { signals, reasons };

  if (isIpLiteral(hostname)) {
    // Solo cuentan las IP públicas. Una IP privada o de loopback la bloquea antes el filtro anti-SSRF
    // en un análisis real, así que aquí solo aparece en pruebas con servidores locales.
    if (AntiSsrfGuard.isPrivateOrReservedIp(hostname.replace(/^\[|\]$/g, ''))) return { signals, reasons };
    signals.push('ip_literal_host');
    reasons.push('El enlace usa una dirección IP en lugar de un nombre de dominio.');
    return { signals, reasons };
  }

  const labels = hostname.split('.');
  const tld = labels[labels.length - 1] ?? '';

  if (SUSPICIOUS_TLDS.has(tld)) {
    signals.push('suspicious_tld');
    reasons.push(`El dominio usa la extensión ".${tld}", común en campañas de abuso.`);
  }

  if (labels.some((label) => label.startsWith('xn--'))) {
    signals.push('punycode_domain');
    reasons.push('El dominio usa caracteres internacionales que pueden imitar letras de otro sitio (punycode).');
  }

  const registrable = registrableDomain(hostname);
  const registrableName = registrable.split('.')[0] ?? '';
  const tokens = hostname.split(/[.-]/);
  const brand = tokens.find((token) => IMPERSONATED_BRANDS.has(token));
  if (brand && registrableName !== brand) {
    signals.push('brand_impersonation');
    reasons.push(`El nombre "${brand}" aparece en el enlace, pero el dominio real es "${registrable}".`);
  }

  return { signals, reasons };
}
