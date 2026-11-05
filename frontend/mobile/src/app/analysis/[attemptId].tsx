import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { authenticatedRequest, useSession } from '../../lib/session';
import { useAnalysisStatusAnnouncement } from '../../lib/useAnalysisStatusAnnouncement';
import { analysisDetailErrorMessage } from '../../lib/analysisErrorMessage';
import { colors, radius, typefaces } from '../../theme/tokens';

type AnalysisDetail = {
  attemptId: string;
  localDate: string;
  receivedAt: string;
  completedAt?: string;
  processingStatus: string;
  submittedInput?: string;
  analysis?: { verdict: string; reasons: string[]; signals?: string[]; finalDestination?: string; redirects?: string[] };
};

const verdicts: Record<string, { title: string; message: string; color: string }> = {
  peligroso: { title: 'Peligroso', message: 'El análisis encontró señales de riesgo. Evita abrir este enlace.', color: colors.danger },
  sospechoso: { title: 'Sospechoso', message: 'Se observaron señales que requieren precaución.', color: colors.warning },
  sin_amenazas_detectadas: { title: 'Sin amenazas detectadas', message: 'No se detectaron amenazas en este análisis. Esto no garantiza que el sitio sea seguro.', color: colors.success },
};
const stateLabel: Record<string, string> = { received: 'Recibido', processing: 'En análisis', completed: 'Análisis completado', failed: 'No se pudo analizar', validation_failed: 'No se pudo validar el enlace', inconclusive: 'Resultado no concluyente' };
const statusCopy: Record<string, { title: string; message: string; color: string; icon: string }> = {
  failed: { title: 'No se pudo analizar', message: 'El análisis no terminó correctamente. No se presentó un veredicto.', color: colors.textSecondary, icon: '!' },
  validation_failed: { title: 'No se pudo validar el enlace', message: 'La solicitud no superó la validación. No se presentó un veredicto.', color: colors.textSecondary, icon: '!' },
  inconclusive: { title: 'Resultado no concluyente', message: 'No hubo evidencia suficiente para emitir un veredicto. No tomes este resultado como garantía de seguridad.', color: colors.textSecondary, icon: '?' },
  completed: { title: 'Análisis completado', message: 'No hay un veredicto disponible para este análisis. No lo interpretes como evidencia de seguridad.', color: colors.textSecondary, icon: '?' },
};

function hostOnly(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.hostname : null;
  } catch { return null; }
}

export default function AnalysisDetailScreen() {
  const router = useRouter();
  const { attemptId, localDate } = useLocalSearchParams<{ attemptId: string; localDate?: string }>();
  const { ready, accessToken, sessionExpired } = useSession();
  const [detail, setDetail] = useState<AnalysisDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pollNote, setPollNote] = useState('');
  const [actionError, setActionError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [now, setNow] = useState(0);
  const hasLoadedDetail = useRef(false);

  useEffect(() => { if (ready && !accessToken) router.replace(sessionExpired ? '/auth/session-expired' : '/auth/login'); }, [ready, accessToken, sessionExpired, router]);

  const load = useCallback(async (signal?: AbortSignal): Promise<AnalysisDetail> => {
    if (!attemptId) { setError('No encontramos el identificador de este análisis.'); setLoading(false); throw new Error('Missing attempt identifier'); }
    setError('');
    try {
      const dateQuery = localDate ? `?localDate=${encodeURIComponent(localDate)}` : '';
      const result = await authenticatedRequest<AnalysisDetail>(`/analyses/${encodeURIComponent(attemptId)}${dateQuery}`, { signal });
      hasLoadedDetail.current = true;
      setDetail(result);
      setPollNote('');
      return result;
    } catch (cause) {
      if (!signal?.aborted && !hasLoadedDetail.current) setError(analysisDetailErrorMessage(cause));
      throw cause;
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [attemptId, localDate]);

  useEffect(() => {
    if (!accessToken) return;
    const controller = new AbortController();
    let active = true;
    let delay = 1200;
    const pause = (milliseconds: number) => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    void (async () => {
      const startedAt = Date.now();
      try {
        do {
          const result = await load(controller.signal);
          if (!active || controller.signal.aborted) return;
          if (!['received', 'processing'].includes(result.processingStatus)) return;
          if (Date.now() - startedAt >= 90000) {
            setPollNote('El análisis sigue en proceso. El resultado quedará en tu historial.');
            return;
          }
          await pause(delay);
          delay = Math.min(Math.round(delay * 1.5), 6000);
        } while (active && !controller.signal.aborted);
      } catch {
        if (active && !controller.signal.aborted && hasLoadedDetail.current) setPollNote('No pudimos actualizar el análisis. Intenta consultar de nuevo.');
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [accessToken, attemptId, load, localDate, refreshVersion]);

  const processing = detail ? ['received', 'processing'].includes(detail.processingStatus) : false;
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [detail?.attemptId, processing]);

  const analysis = detail?.analysis;
  const verdict = analysis?.verdict ? verdicts[analysis.verdict] : null;
  const elapsedSeconds = detail?.receivedAt && Number.isFinite(new Date(detail.receivedAt).getTime())
    ? Math.max(0, Math.floor((now - new Date(detail.receivedAt).getTime()) / 1000)) : 0;
  const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
  useAnalysisStatusAnnouncement(detail ? {
    attemptId: detail.attemptId,
    status: detail.processingStatus,
    verdict: detail.analysis?.verdict,
    message: processing ? 'El análisis sigue en curso.' : verdict
      ? `Resultado del análisis: ${verdict.title}. ${verdict.message}`
      : `${stateLabel[detail.processingStatus] ?? 'El estado del análisis'} actualizado.`,
  } : null);
  const receivedDate = detail?.receivedAt && Number.isFinite(new Date(detail.receivedAt).getTime())
    ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(detail.receivedAt))
    : 'Fecha no disponible';
  const resultDate = detail?.completedAt && Number.isFinite(new Date(detail.completedAt).getTime())
    ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(detail.completedAt))
    : receivedDate;
  const resultDateLabel = detail?.completedAt ? 'Analizado el' : 'Recibido el';
  const presentation = verdict ?? (detail ? statusCopy[detail.processingStatus] : undefined);
  const resultIcon = verdict
    ? verdict.title === 'Sin amenazas detectadas' ? '✓' : verdict.title === 'Peligroso' ? '×' : '!'
    : statusCopy[detail?.processingStatus ?? '']?.icon ?? '!';

  async function retryAnalysis() {
    if (!detail?.submittedInput || retrying) {
      router.replace('/analysis?tab=analyze');
      return;
    }
    setRetrying(true);
    setActionError('');
    try {
      const accepted = await authenticatedRequest<{ attemptId: string; localDate: string }>('/analyses', {
        method: 'POST',
        body: JSON.stringify({ input: detail.submittedInput }),
      });
      router.replace({ pathname: '/analysis/[attemptId]', params: { attemptId: accepted.attemptId, localDate: accepted.localDate } });
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      setActionError(status === 429
        ? 'Alcanzaste el límite diario de análisis. Vuelve a intentarlo cuando se restablezca tu cuota.'
        : 'No pudimos iniciar otro análisis. Puedes volver al inicio o consultar tu historial.');
    } finally { setRetrying(false); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Volver al inicio" onPress={() => router.replace('/analysis')} style={styles.back}><Text style={styles.backGlyph}>‹</Text></Pressable>
          <Text accessibilityRole="header" style={styles.headerTitle}>{processing ? 'Analizando' : 'Resultado'}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {loading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.secondary}>Cargando análisis…</Text></View> : error ? (
            <View style={styles.errorCard}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable onPress={() => { setLoading(true); setRefreshVersion((value) => value + 1); }} accessibilityRole="button"><Text style={styles.action}>Volver a intentar</Text></Pressable></View>
          ) : detail && (
            <>
              {processing ? (
                <View style={styles.processingContent}>
                  <View accessibilityLabel={`Estado: ${detail.processingStatus === 'received' ? 'Recibido' : 'Analizando'}`} style={styles.stepper}>
                    {['Recibido', 'En fila', 'Analizando'].map((step, index) => {
                      const activeStep = detail.processingStatus === 'received' ? 0 : 2;
                      const complete = index < activeStep;
                      const active = index === activeStep;
                      return <View key={step} style={styles.step}><View style={[styles.stepDot, complete && styles.stepComplete, active && styles.stepActive]} /><Text style={[styles.stepLabel, (complete || active) && styles.stepLabelActive]}>{step}</Text></View>;
                    })}
                  </View>
                  <View style={styles.progressBadge}><ActivityIndicator size="large" color={colors.primaryText} /></View>
                  <Text accessibilityRole="header" style={styles.processingTitle}>Revisando el enlace</Text>
                  <Text style={styles.processingHint}>Puede tardar unos segundos, hasta 1 minuto si hay mucha demanda.</Text>
                  <Text accessibilityLabel={`Tiempo transcurrido ${elapsedLabel}`} style={styles.timer}>{elapsedLabel}</Text>
                  <View style={styles.linkCard}>
                    <Text style={styles.kicker}>ENLACE</Text>
                    <Text numberOfLines={1} style={styles.domain}>{hostOnly(detail.submittedInput) ?? 'Enlace recibido'}</Text>
                    <Text style={styles.helper}>Mostramos solo el dominio para proteger el resto de la URL.</Text>
                  </View>
                  <View style={styles.checklist}>
                    <Text style={styles.checkItem}>✓  Recibimos tu enlace</Text>
                    <Text style={detail.processingStatus === 'processing' ? styles.checkItem : styles.pendingItem}>{detail.processingStatus === 'processing' ? '✓' : '○'}  En fila para un entorno aislado</Text>
                    <Text style={detail.processingStatus === 'processing' ? styles.checkItem : styles.pendingItem}>{detail.processingStatus === 'processing' ? '•' : '○'}  Análisis en entorno aislado</Text>
                  </View>
                  {!!pollNote && <Text accessibilityRole="alert" style={styles.pollNote}>{pollNote}</Text>}
                  {pollNote !== '' && <Pressable onPress={() => { setLoading(true); setRefreshVersion((value) => value + 1); }} accessibilityRole="button"><Text style={styles.action}>Consultar de nuevo</Text></Pressable>}
                  <Pressable onPress={() => router.replace('/analysis')} accessibilityRole="button" style={styles.backgroundButton}><Text style={styles.backgroundButtonText}>Seguir en segundo plano</Text></Pressable>
                  <Text style={styles.helper}>El resultado quedará en tu historial.</Text>
                </View>
              ) : (
                <>
                  <View style={[styles.verdictCard, styles.resultCard, { borderLeftColor: presentation?.color ?? colors.textSecondary }]}>
                    <View style={[styles.resultIcon, { backgroundColor: `${presentation?.color ?? colors.textSecondary}22` }]}>
                      <Text style={[styles.resultIconText, { color: presentation?.color ?? colors.textSecondary }]}>{resultIcon}</Text>
                    </View>
                    <Text accessibilityRole="header" style={[styles.verdict, { color: presentation?.color ?? colors.textSecondary }]}>{presentation?.title ?? stateLabel[detail.processingStatus] ?? 'Estado no disponible'}</Text>
                    <Text style={styles.secondary}>{presentation?.message ?? 'No se presentó un veredicto.'}</Text>
                    <Text style={styles.meta}>{verdict ? resultDateLabel : 'Recibido el'} {verdict ? resultDate : receivedDate}</Text>
                  </View>
                  <View style={styles.section}>
                    <Text style={styles.kicker}>ENLACE ANALIZADO</Text>
                    <Text numberOfLines={2} style={styles.domain}>{hostOnly(detail.submittedInput) ?? 'Dominio no disponible'}</Text>
                    <Text style={styles.helper}>Se muestra solo el dominio; no se exponen ruta ni parámetros del enlace.</Text>
                  </View>
                  {!!analysis?.reasons?.length && <View style={styles.section}><Text style={styles.sectionTitle}>Razones del análisis</Text>{analysis.reasons.map((reason, index) => <Text key={`${index}-${reason}`} style={styles.bullet}>•  {reason}</Text>)}</View>}
                  {!!analysis?.finalDestination && <View style={styles.section}><Text style={styles.sectionTitle}>Destino final observado</Text><Text style={styles.domain}>{hostOnly(analysis.finalDestination) ?? 'Destino no disponible'}</Text></View>}
                  {!!analysis?.redirects?.length && <View style={styles.section}><Text style={styles.sectionTitle}>Redirecciones observadas</Text>{analysis.redirects.map((redirect, index) => <Text key={`${index}-${redirect}`} style={styles.domain}>{index + 1}. {hostOnly(redirect) ?? 'Destino no disponible'}</Text>)}</View>}
                  {!!actionError && <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text>}
                  {detail.processingStatus === 'failed' ? (
                    <>
                      <Pressable onPress={() => void retryAnalysis()} disabled={retrying} accessibilityRole="button" style={styles.primaryAction}>
                        {retrying ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryActionText}>Intentar de nuevo</Text>}
                      </Pressable>
                      <Text style={styles.helper}>El reintento crea una nueva solicitud y puede consumir cuota.</Text>
                      <Pressable onPress={() => router.replace('/analysis')} accessibilityRole="button" style={styles.secondaryAction}><Text style={styles.secondaryActionText}>Volver al inicio</Text></Pressable>
                    </>
                  ) : (
                    <>
                      <Pressable onPress={() => router.replace('/analysis?tab=analyze')} accessibilityRole="button" style={styles.primaryAction}><Text style={styles.primaryActionText}>Analizar otro enlace</Text></Pressable>
                      <Pressable onPress={() => router.replace('/history')} accessibilityRole="button" style={styles.secondaryLink}><Text style={styles.action}>Ver en historial</Text></Pressable>
                    </>
                  )}
                  <Text style={styles.disclaimer}>El resultado es informativo y no garantiza que un sitio sea seguro. Las señales del Sandbox no equivalen a consultas a proveedores externos.</Text>
                </>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1 },
  header: { height: 54, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { width: 36, height: 42, justifyContent: 'center' },
  backGlyph: { color: colors.text, fontSize: 32, lineHeight: 36 },
  headerSpacer: { width: 36 },
  headerTitle: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 16 },
  content: { padding: 22, paddingTop: 25, gap: 14, paddingBottom: 28 },
  kicker: { color: colors.primaryText, fontFamily: typefaces.semibold, fontSize: 11, letterSpacing: 1.4 },
  verdictCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 18, gap: 12 },
  resultCard: { borderLeftWidth: 4, alignItems: 'flex-start' },
  resultIcon: { width: 42, height: 42, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  resultIconText: { fontFamily: typefaces.bold, fontSize: 20 },
  verdict: { color: colors.text, fontFamily: typefaces.bold, fontSize: 19 },
  secondary: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 13, lineHeight: 20 },
  meta: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 11, marginTop: 2 },
  section: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 16, gap: 11 },
  sectionTitle: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 14 },
  bullet: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 13, lineHeight: 20 },
  domain: { color: colors.text, fontFamily: typefaces.medium, fontSize: 13 },
  helper: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 11, lineHeight: 16 },
  disclaimer: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 4 },
  loading: { padding: 30, alignItems: 'center', gap: 12 },
  processingContent: { alignItems: 'center', gap: 16, paddingTop: 10 },
  stepper: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  step: { alignItems: 'center', gap: 7 },
  stepDot: { width: 10, height: 10, borderRadius: 8, backgroundColor: colors.border },
  stepComplete: { backgroundColor: colors.success },
  stepActive: { backgroundColor: colors.primary, width: 13, height: 13 },
  stepLabel: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 11 },
  stepLabelActive: { color: colors.primaryText, fontFamily: typefaces.semibold },
  progressBadge: { width: 92, height: 92, borderRadius: 48, borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  processingTitle: { color: colors.text, fontFamily: typefaces.bold, fontSize: 21 },
  processingHint: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 300 },
  timer: { color: colors.primaryText, fontFamily: typefaces.semibold, fontSize: 18, fontVariant: ['tabular-nums'] },
  linkCard: { width: '100%', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 16, gap: 8 },
  checklist: { alignSelf: 'stretch', gap: 12, paddingHorizontal: 10 },
  checkItem: { color: colors.textSecondary, fontFamily: typefaces.medium, fontSize: 13 },
  pendingItem: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 13 },
  backgroundButton: { width: '100%', backgroundColor: colors.primaryAction, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  backgroundButtonText: { color: colors.white, fontFamily: typefaces.semibold, fontSize: 14 },
  primaryAction: { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.primaryAction, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  primaryActionText: { color: colors.white, fontFamily: typefaces.semibold, fontSize: 14 },
  secondaryAction: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  secondaryActionText: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 14 },
  secondaryLink: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  pollNote: { color: colors.warning, fontFamily: typefaces.regular, fontSize: 12, textAlign: 'center' },
  errorCard: { backgroundColor: '#3A202B', borderRadius: radius.md, padding: 14, gap: 10 },
  error: { color: '#FF9BAA', fontFamily: typefaces.medium, fontSize: 13, lineHeight: 19 },
  action: { color: colors.primaryText, fontFamily: typefaces.semibold, fontSize: 13 },
});
