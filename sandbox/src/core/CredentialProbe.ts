import { randomBytes } from 'node:crypto';
import { registrableDomain } from './UrlHeuristics.js';

/**
 * Prueba de credenciales falsas ("canario").
 *
 * El sandbox llena el formulario de acceso con una identidad y una contraseña inventadas y
 * únicas por análisis, y observa qué hace la página con ellas. Los datos nunca son reales:
 * el dominio .invalid está reservado y no puede recibir correo.
 *
 * La idea clave: un sitio legítimo rechaza credenciales inventadas. Una página de phishing
 * las acepta, porque solo quiere guardarlas, y suele pedir el siguiente dato (tarjeta, código
 * SMS) o mandar al usuario al sitio real para que no sospeche.
 */
export interface Canary {
  identity: string;
  password: string;
}

export type FollowUpKind = 'card' | 'cvv' | 'otp' | 'pin';

export interface ProbeObservation {
  /** URL de la página donde estaba el formulario. */
  pageUrl: string;
  /** Si se llegaron a llenar y enviar los campos. */
  submitted: boolean;
  /** URLs de las peticiones que llevaban la identidad o la contraseña falsas. */
  exfiltrationUrls: string[];
  /** Tipos de datos que la página pidió después de aceptar las credenciales falsas. */
  followUpKinds: FollowUpKind[];
  /** URL de la página después del envío. */
  urlAfterSubmit?: string;
}

export function createCanary(): Canary {
  return {
    identity: `es${randomBytes(5).toString('hex')}@enlaceseguro.invalid`,
    password: `Es-${randomBytes(12).toString('base64url')}`
  };
}

function decodeLoosely(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** Revisa si una petición lleva la identidad o la contraseña falsas, en la URL o en el cuerpo. */
export function carriesCanary(canary: Canary, url: string, body?: string | null): boolean {
  const haystacks = [url, decodeLoosely(url)];
  if (body) haystacks.push(body, decodeLoosely(body));
  const needles = [canary.identity, canary.password, canary.identity.split('@')[0] as string];
  return haystacks.some((text) => needles.some((needle) => needle.length >= 8 && text.includes(needle)));
}

function siteOf(url: string): string | null {
  try {
    return registrableDomain(new URL(url).hostname.toLowerCase());
  } catch {
    return null;
  }
}

/** Convierte lo observado en señales para el veredicto. */
export function analyzeProbe(observation: ProbeObservation): { signals: string[]; exfiltrationSites: string[] } {
  const signals: string[] = [];
  if (!observation.submitted) return { signals, exfiltrationSites: [] };
  signals.push('credential_probe_submitted');

  const pageSite = siteOf(observation.pageUrl);
  const exfiltrationSites = [...new Set(observation.exfiltrationUrls
    .map(siteOf)
    .filter((site): site is string => site !== null && site !== pageSite))];

  if (exfiltrationSites.length > 0) {
    signals.push('credential_exfiltration_detected');
  } else if (observation.exfiltrationUrls.length > 0) {
    // Enviar el formulario al mismo sitio es lo normal; solo se registra.
    signals.push('credentials_sent_to_same_site');
  }

  if (observation.followUpKinds.some((kind) => kind === 'card' || kind === 'cvv')) {
    signals.push('requests_card_data_after_login');
  }
  if (observation.followUpKinds.some((kind) => kind === 'otp' || kind === 'pin')) {
    signals.push('requests_security_code_after_login');
  }

  const afterSite = observation.urlAfterSubmit ? siteOf(observation.urlAfterSubmit) : null;
  if (afterSite && pageSite && afterSite !== pageSite) {
    signals.push('post_login_redirect_to_other_site');
  }

  return { signals, exfiltrationSites };
}

/**
 * Clasifica un campo de formulario por sus atributos (name, id, placeholder, autocomplete, aria-label).
 * Se usa dentro del navegador, por eso recibe solo texto.
 */
export function classifyFollowUpField(attributes: string, maxLength?: number): FollowUpKind | null {
  const text = attributes.toLowerCase();
  if (/cc-csc|cvv|cvc|c[oó]digo de seguridad|security code/.test(text)) return 'cvv';
  if (/cc-number|card.?number|n[uú]mero de tarjeta|tarjeta|cardnumber|\bpan\b/.test(text)) return 'card';
  if (/one-time-code|\botp\b|\bsms\b|token|verification|verificaci[oó]n|din[aá]mic|c[oó]digo (de )?(acceso|sms|verificaci|confirmaci)/.test(text)) return 'otp';
  if (/\bnip\b|\bpin\b/.test(text) || (maxLength !== undefined && maxLength > 0 && maxLength <= 4 && /password|clave/.test(text))) return 'pin';
  return null;
}
