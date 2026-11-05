import { colors } from '../theme/tokens';

export type AnalysisPresentationInput = {
  processingStatus: string;
  analysis?: { verdict?: string };
};

export type AnalysisPresentation = { label: string; icon: string; color: string };

const STATUS_LABELS: Record<string, string> = {
  received: 'Recibido',
  processing: 'En análisis',
  completed: 'Completado',
  failed: 'Error',
  validation_failed: 'No validado',
  inconclusive: 'No concluyente',
};

const VERDICT_LABELS: Record<string, string> = {
  peligroso: 'Peligroso',
  sospechoso: 'Sospechoso',
  sin_amenazas_detectadas: 'Sin amenazas detectadas',
};

export function analysisPresentation(item: AnalysisPresentationInput): AnalysisPresentation {
  const verdict = item.analysis?.verdict;
  if (verdict === 'peligroso') return { label: VERDICT_LABELS[verdict], icon: '!', color: colors.danger };
  if (verdict === 'sospechoso') return { label: VERDICT_LABELS[verdict], icon: '!', color: colors.warning };
  if (verdict === 'sin_amenazas_detectadas') return { label: VERDICT_LABELS[verdict], icon: '✓', color: colors.success };
  if (item.processingStatus === 'received' || item.processingStatus === 'processing') {
    return { label: STATUS_LABELS[item.processingStatus], icon: '…', color: colors.primaryText };
  }
  if (item.processingStatus === 'failed' || item.processingStatus === 'validation_failed') {
    return { label: STATUS_LABELS[item.processingStatus], icon: '!', color: colors.textSecondary };
  }
  if (item.processingStatus === 'inconclusive') {
    return { label: STATUS_LABELS[item.processingStatus], icon: '?', color: colors.textSecondary };
  }
  return { label: STATUS_LABELS[item.processingStatus] ?? 'Estado no disponible', icon: '•', color: colors.textSecondary };
}
