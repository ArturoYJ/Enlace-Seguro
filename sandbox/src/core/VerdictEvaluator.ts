export type Verdict = 'peligroso' | 'sospechoso' | 'sin_amenazas_detectadas';

export interface EvaluationInput {
  targetUrl: string;
  finalDestination: string;
  redirects: string[];
  signals: string[];
  blockedSsrf?: boolean;
  ssrfReason?: string;
  loadFailed?: boolean;
  errorMessage?: string;
}

export interface VerdictEvaluationResult {
  verdict: Verdict;
  reasons: string[];
  signals: string[];
}

export class VerdictEvaluator {
  public static evaluate(input: EvaluationInput): VerdictEvaluationResult {
    const reasons: string[] = [];
    const signals = [...input.signals];

    // 1. SSRF or Private IP attempts are automatically critical
    if (input.blockedSsrf) {
      signals.push('ssrf_attempt_blocked');
      reasons.push(
        input.ssrfReason || 'El enlace intenta acceder a recursos internos, privados o reservados de red (anti-SSRF).'
      );
      return {
        verdict: 'peligroso',
        reasons: reasons.slice(0, 10),
        signals: signals.slice(0, 50)
      };
    }

    // 2. High severity signals -> peligroso
    if (signals.includes('password_input_on_http')) {
      reasons.push('Se detectó un formulario de ingreso de contraseñas sobre una conexión no cifrada (HTTP).');
    }

    if (signals.includes('credential_harvesting_detected')) {
      reasons.push('La página presenta estructura característica de suplantación de identidad (phishing).');
    }

    if (signals.includes('download_attempt_blocked')) {
      reasons.push('La página intentó desencadenar la descarga automática de archivos sin consentimiento.');
    }

    if (signals.includes('untrusted_tls_certificate')) {
      reasons.push('El certificado TLS del servidor no es confiable, está caducado o es inválido.');
    }

    if (reasons.length > 0) {
      return {
        verdict: 'peligroso',
        reasons: reasons.slice(0, 10),
        signals: signals.slice(0, 50)
      };
    }

    // 3. Medium severity signals -> sospechoso
    if (input.redirects.length >= 3) {
      signals.push('excessive_redirect_chain');
      reasons.push(`El enlace ejecuta múltiples redirecciones encadenadas (${input.redirects.length} saltos).`);
    }

    // Check if redirect switched domains
    if (input.redirects.length > 0) {
      try {
        const initialDomain = new URL(input.targetUrl).hostname;
        const finalDomain = new URL(input.finalDestination).hostname;
        if (initialDomain !== finalDomain) {
          signals.push('cross_domain_redirect');
          reasons.push(`Redirección hacia un dominio diferente: de '${initialDomain}' a '${finalDomain}'.`);
        }
      } catch {
        // ignore malformed URL in heuristic
      }
    }

    if (signals.includes('hidden_iframe_detected')) {
      reasons.push('Se identificaron marcos ocultos (iframes invisibles) embebidos en el documento.');
    }

    if (signals.includes('cross_origin_form_action')) {
      reasons.push('Los formularios de la página envían datos hacia un dominio externo no coincidente.');
    }

    if (signals.includes('suspicious_tld')) {
      reasons.push('El dominio utiliza una extensión de nivel superior comúnmente asociada a campañas de abuso.');
    }

    if (reasons.length > 0) {
      return {
        verdict: 'sospechoso',
        reasons: reasons.slice(0, 10),
        signals: signals.slice(0, 50)
      };
    }

    // 4. Clean verdict
    reasons.push(
      'Carga completada en entorno aislado sin señales de riesgo detectadas. Este análisis es preventivo y no constituye garantía de seguridad absoluta.'
    );

    return {
      verdict: 'sin_amenazas_detectadas',
      reasons: reasons.slice(0, 10),
      signals: signals.slice(0, 50)
    };
  }
}
