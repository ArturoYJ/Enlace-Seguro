export type ReputationTone = 'danger' | 'success' | 'neutral';
export type ReputationInfo = { chip: string; tone: ReputationTone; text: string };

type SourceResult = { sourceName: string; status: string; summary?: string };
type SourceFailure = { sourceName: string; reasonCode: string };

const dateFormat = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' });

// La API arma el resumen con fechas ISO ("Informe del 2026-11-22T04:39:54.000Z; detecciones
// maliciosas: 0."); en pantalla se muestran en hora local y en un formato que se lea fácil.
export function readableSummary(summary?: string): string {
  if (!summary) return '';
  return summary.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (iso) => {
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) ? dateFormat.format(date) : iso;
  }).trim();
}

export function reputationInfo(sourceResults?: SourceResult[], sourceFailures?: SourceFailure[]): ReputationInfo {
  const result = sourceResults?.find((item) => item.sourceName === 'VirusTotal');
  if (result?.status === 'match') {
    return { chip: 'Con detecciones', tone: 'danger', text: `Antivirus de VirusTotal ya reportan este enlace. ${readableSummary(result.summary)}`.trim() };
  }
  if (result?.status === 'no_match') {
    return { chip: 'Sin detecciones', tone: 'success', text: `Ningún antivirus lo ha reportado todavía. ${readableSummary(result.summary)}`.trim() };
  }
  const failure = sourceFailures?.find((item) => item.sourceName === 'VirusTotal');
  switch (failure?.reasonCode) {
    case 'not_found': return { chip: 'Sin informe', tone: 'neutral', text: 'VirusTotal no tiene un informe de este enlace. Puede ser un sitio nuevo.' };
    case 'rate_limited': return { chip: 'No disponible', tone: 'neutral', text: 'Consulta no disponible por límite de solicitudes.' };
    case 'error': return { chip: 'No disponible', tone: 'neutral', text: 'No fue posible consultar esta fuente.' };
    case 'not_queried': return { chip: 'No consultado', tone: 'neutral', text: 'No se consultó esta fuente.' };
    default: return { chip: 'Sin datos', tone: 'neutral', text: 'No hay información disponible sobre esta fuente.' };
  }
}
