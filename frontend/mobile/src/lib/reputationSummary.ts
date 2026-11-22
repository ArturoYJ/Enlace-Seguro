export type ReputationTone = 'danger' | 'success' | 'neutral';
export type ReputationInfo = { headline: string; short: string; tone: ReputationTone; text: string; checkedAt?: string };

type SourceResult = { sourceName: string; status: string; summary?: string };
type SourceFailure = { sourceName: string; reasonCode: string };

const ISO_DATE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/;
const dateFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' });

// La API arma el resumen con fechas ISO ("Informe del 2026-11-22T04:39:54.000Z; detecciones
// maliciosas: 0."); en pantalla se muestran en hora local y en un formato que se lea fácil.
export function readableSummary(summary?: string): string {
  if (!summary) return '';
  return summary.replace(new RegExp(ISO_DATE.source, 'g'), (iso) => {
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) ? dateFormat.format(date) : iso;
  }).trim();
}

function reportDate(summary?: string): string | undefined {
  const iso = summary?.match(ISO_DATE)?.[0];
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : undefined;
}

function detections(summary?: string): number | undefined {
  const value = summary?.match(/detecciones maliciosas:\s*(\d+)/i)?.[1];
  return value === undefined ? undefined : Number(value);
}

function domainOf(summary?: string): string | undefined {
  return summary?.match(/Informe del dominio (\S+) del/)?.[1];
}

export function reputationInfo(sourceResults?: SourceResult[], sourceFailures?: SourceFailure[]): ReputationInfo {
  const result = sourceResults?.find((item) => item.sourceName === 'VirusTotal');
  if (result?.status === 'match') {
    const count = detections(result.summary);
    const domain = domainOf(result.summary);
    return {
      headline: count ? `${count} antivirus lo reportan como peligroso` : 'Los antivirus lo reportan como peligroso',
      short: 'Lo reportan',
      tone: 'danger',
      text: domain ? `Otros programas antivirus ya marcaron el sitio ${domain} como dañino.` : 'Otros programas antivirus ya identificaron este enlace como dañino.',
      checkedAt: reportDate(result.summary),
    };
  }
  if (result?.status === 'no_match') {
    const domain = domainOf(result.summary);
    return {
      headline: domain ? `Ningún antivirus ha reportado el sitio ${domain}` : 'Ningún antivirus lo ha reportado',
      short: 'Sin reportes',
      // Gris y no verde: que nadie lo haya reportado no significa que sea seguro.
      tone: 'neutral',
      text: 'Ojo: un sitio falso recién creado suele no estar reportado todavía. Por eso también lo abrimos en un lugar seguro.',
      checkedAt: reportDate(result.summary),
    };
  }
  const failure = sourceFailures?.find((item) => item.sourceName === 'VirusTotal');
  switch (failure?.reasonCode) {
    case 'not_found': return { headline: 'Los antivirus aún no conocen este enlace', short: 'Desconocido', tone: 'neutral', text: 'Puede ser un sitio nuevo. Que no lo conozcan no significa que sea seguro.' };
    case 'rate_limited': return { headline: 'No pudimos preguntar a los antivirus', short: 'Sin respuesta', tone: 'neutral', text: 'Se alcanzó el límite de consultas. Intenta más tarde.' };
    case 'error': return { headline: 'No pudimos preguntar a los antivirus', short: 'Sin respuesta', tone: 'neutral', text: 'Hubo un problema al consultar. El resultado del análisis seguro sigue siendo válido.' };
    case 'not_queried': return { headline: 'No se preguntó a los antivirus', short: 'No consultado', tone: 'neutral', text: 'Esta revisión está apagada para este enlace.' };
    default: return { headline: 'Sin información de los antivirus', short: 'Sin datos', tone: 'neutral', text: 'No hay información disponible de esta fuente.' };
  }
}
