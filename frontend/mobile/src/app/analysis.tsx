import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputInstance } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { BottomTabs } from '../components/BottomTabs';
import { NoticeDialog } from '../components/NoticeDialog';
import { Alert } from '../components/Alert';
import { Skeleton } from '../components/Skeleton';
import { authenticatedRequest, useSession } from '../lib/session';
import { extractAnalysisUrl, MAX_ANALYSIS_INPUT_LENGTH } from '../lib/analysisInput';
import { analysisPresentation } from '../lib/analysisPresentation';
import { safeApiErrorMessage } from '../lib/safeApiErrorMessage';
import { colors, radius, typefaces } from '../theme/tokens';

type Admission = { attemptId: string; localDate: string; processingStatus: string };
type Me = { user: { email: string }; quota: { remaining: number; limit: number; resetAt: string } };
type RecentAnalysis = {
  attemptId: string;
  localDate: string;
  receivedAt: string;
  processingStatus: string;
  submittedInput?: string;
  analysis?: { verdict?: string };
};
type RecentAnalysesResponse = { items: RecentAnalysis[] };
type AnalysisSummary = {
  window: { startsAtInclusive: string; endsAtExclusive: string };
  total: number;
  dangerous: number;
  suspicious: number;
};

function safeHost(input?: string): string {
  if (!input) return 'Enlace analizado';
  try {
    const value = new URL(input);
    return ['http:', 'https:'].includes(value.protocol) && value.hostname ? value.hostname : 'Enlace analizado';
  } catch { return 'Enlace analizado'; }
}

function recentDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City',
  }).format(date);
}

function quotaResetLabel(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-MX', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Mexico_City',
  }).format(date);
}

export default function AnalysisScreen() {
  const router = useRouter();
  const { ready, accessToken, sessionExpired } = useSession();
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const [url, setUrl] = useState('');
  const [me, setMe] = useState<Me | null>(null);
  const [profileStatus, setProfileStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<RecentAnalysis[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState('');
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [message, setMessage] = useState('');
  const [noticeType, setNoticeType] = useState<'offline' | 'quota' | null>(null);
  const submittingRef = useRef(false);
  const urlInputRef = useRef<TextInputInstance | null>(null);
  const profileRequestVersion = useRef(0);
  const recentRequestVersion = useRef(0);
  const recentAbortRef = useRef<AbortController | null>(null);
  const summaryRequestVersion = useRef(0);
  const summaryAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (ready && !accessToken) router.replace(sessionExpired ? '/auth/session-expired' : '/auth/login');
  }, [ready, accessToken, sessionExpired, router]);

  useEffect(() => {
    if (tab === 'analyze') urlInputRef.current?.focus();
  }, [tab]);

  const loadMe = useCallback(async () => {
    const requestVersion = ++profileRequestVersion.current;
    setProfileStatus('loading');
    try {
      const profile = await authenticatedRequest<Me>('/auth/me');
      if (requestVersion === profileRequestVersion.current) {
        setMe(profile);
        setProfileStatus('ready');
      }
    } catch {
      if (requestVersion === profileRequestVersion.current) {
        setMe(null);
        setProfileStatus('error');
      }
    }
  }, []);

  const loadRecent = useCallback(async () => {
    const requestVersion = ++recentRequestVersion.current;
    recentAbortRef.current?.abort();
    const controller = new AbortController();
    recentAbortRef.current = controller;
    setRecentLoading(true);
    setRecentError('');
    try {
      const page = await authenticatedRequest<RecentAnalysesResponse>('/analyses?limit=3', { signal: controller.signal });
      if (requestVersion === recentRequestVersion.current && !controller.signal.aborted) setRecent(page.items.slice(0, 3));
    } catch (error) {
      if (requestVersion === recentRequestVersion.current && !controller.signal.aborted) {
        setRecentError(safeApiErrorMessage(error, 'No pudimos cargar tus análisis recientes.'));
      }
    } finally {
      if (requestVersion === recentRequestVersion.current) {
        setRecentLoading(false);
        if (recentAbortRef.current === controller) recentAbortRef.current = null;
      }
    }
  }, []);

  const loadSummary = useCallback(async () => {
    const requestVersion = ++summaryRequestVersion.current;
    summaryAbortRef.current?.abort();
    const controller = new AbortController();
    summaryAbortRef.current = controller;
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const result = await authenticatedRequest<AnalysisSummary>('/analyses/summary', { signal: controller.signal });
      if (requestVersion === summaryRequestVersion.current && !controller.signal.aborted) setSummary(result);
    } catch (error) {
      if (requestVersion === summaryRequestVersion.current && !controller.signal.aborted) {
        setSummaryError(safeApiErrorMessage(error, 'No pudimos cargar tus métricas.'));
      }
    } finally {
      if (requestVersion === summaryRequestVersion.current) {
        setSummaryLoading(false);
        if (summaryAbortRef.current === controller) summaryAbortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void Promise.resolve().then(() => { if (active) void loadMe(); });
    return () => {
      active = false;
      profileRequestVersion.current += 1;
    };
  }, [accessToken, loadMe]);

  useEffect(() => {
    if (!accessToken) return;
    const timer = setTimeout(() => { void loadRecent(); }, 0);
    return () => {
      clearTimeout(timer);
      recentRequestVersion.current += 1;
      recentAbortRef.current?.abort();
    };
  }, [accessToken, loadRecent]);

  useEffect(() => {
    if (!accessToken) return;
    const timer = setTimeout(() => { void loadSummary(); }, 0);
    return () => {
      clearTimeout(timer);
      summaryRequestVersion.current += 1;
      summaryAbortRef.current?.abort();
    };
  }, [accessToken, loadSummary]);

  async function submit() {
    if (submittingRef.current) return;
    setMessage('');
    const extracted = extractAnalysisUrl(url);
    if (!extracted.ok) {
      const messages = {
        too_long: `El texto supera el límite de ${MAX_ANALYSIS_INPUT_LENGTH} caracteres.`,
        missing_url: 'Incluye un enlace que comience con http:// o https://.',
        multiple_urls: 'El mensaje contiene varios enlaces. Deja solo uno para analizarlo.',
        invalid_url: 'El enlace no parece válido. Revisa que incluya un dominio y use http:// o https://.',
      } as const;
      setMessage(messages[extracted.reason]);
      return;
    }
    const analysisUrl = extracted.url;
    submittingRef.current = true;
    setBusy(true);
    try {
      // Only the extracted URL leaves this screen; surrounding message text stays local.
      const accepted = await authenticatedRequest<Admission>('/analyses', { method: 'POST', body: JSON.stringify({ input: analysisUrl }) });
      setUrl('');
      await loadMe();
      void loadSummary();
      void loadRecent();
      router.push({ pathname: '/analysis/[attemptId]', params: { attemptId: accepted.attemptId, localDate: accepted.localDate } });
    } catch (error) {
      const status = (error as { status?: number }).status;
      const code = (error as { code?: string }).code;
      if (status === 429) {
        setMe(null);
        setMessage('');
        setNoticeType('quota');
        void loadMe();
      } else if (code === 'NETWORK_ERROR') {
        setMessage('');
        setNoticeType('offline');
      } else {
        const status = (error as { status?: number }).status;
        setMessage(status === 400
          ? 'No pudimos validar ese enlace. Revisa la dirección e inténtalo de nuevo.'
          : 'No pudimos iniciar el análisis. Inténtalo de nuevo más tarde.');
      }
    } finally { submittingRef.current = false; setBusy(false); }
  }

  async function pasteFromClipboard() {
    setMessage('');
    try {
      const clipboardText = await Clipboard.getStringAsync();
      if (!clipboardText.trim()) { setMessage('El portapapeles está vacío. Copia un enlace o mensaje y vuelve a intentarlo.'); return; }
      if (clipboardText.length > MAX_ANALYSIS_INPUT_LENGTH) {
        setUrl('');
        setMessage(`El texto supera el límite de ${MAX_ANALYSIS_INPUT_LENGTH} caracteres. Pega solo el enlace o un fragmento más corto.`);
        return;
      }
      setUrl(clipboardText.trim());
    } catch {
      setMessage('No pudimos leer el portapapeles. También puedes pegar el enlace en el campo.');
    }
  }

  const quotaReset = quotaResetLabel(profileStatus === 'ready' ? me?.quota.resetAt : undefined);
  const quotaDescription = profileStatus === 'ready' && me?.quota.limit !== undefined
    ? `Alcanzaste el límite diario de ${me.quota.limit} análisis.`
    : 'Alcanzaste la cuota diaria de análisis de tu cuenta.';
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable onPress={() => router.push('/account')} accessibilityRole="button" accessibilityLabel="Mi cuenta" style={styles.profileButton}>
            <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>ES</Text></View>
            <View><Text style={styles.profileGreeting}>Hola</Text><Text style={styles.profileName}>EnlaceSeguro</Text></View>
          </Pressable>
        </View>
        <View style={styles.greeting}>
          <Text style={styles.kicker}>ANALIZA UN ENLACE</Text>
          <Text accessibilityRole="header" style={styles.subtitle}>Pega el enlace o el texto completo de tu mensaje.</Text>
        </View>
        <View style={styles.card}>
          <TextInput
            ref={urlInputRef}
            accessibilityLabel="Enlace o mensaje para analizar"
            value={url}
            onChangeText={(value) => {
              if (value.length > MAX_ANALYSIS_INPUT_LENGTH) {
                setUrl('');
                setMessage(`El texto supera el límite de ${MAX_ANALYSIS_INPUT_LENGTH} caracteres.`);
                return;
              }
              setUrl(value);
              setMessage('');
            }}
            placeholder="Pega aquí el enlace o el mensaje"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            textAlignVertical="top"
            style={styles.input}
          />
          <View style={styles.inputActions}>
            <Pressable onPress={() => void pasteFromClipboard()} accessibilityRole="button" accessibilityLabel="Pegar enlace o mensaje del portapapeles" hitSlop={8} style={styles.textAction}>
              <Text style={styles.paste}>Pegar</Text>
            </Pressable>
            <Text accessibilityLabel={`${url.length} de ${MAX_ANALYSIS_INPUT_LENGTH} caracteres`} style={styles.characterCount}>{url.length} / {MAX_ANALYSIS_INPUT_LENGTH}</Text>
            <Pressable onPress={() => { setUrl(''); setMessage(''); }} accessibilityRole="button" accessibilityLabel="Borrar texto" disabled={!url} hitSlop={8} style={styles.textAction}>
              <Text style={[styles.clearText, !url && styles.disabledTextAction]}>Borrar</Text>
            </Pressable>
          </View>
          <Text style={styles.helper}>El texto del mensaje se procesa en este dispositivo. Solo enviaremos el enlace extraído para analizarlo.</Text>
          {profileStatus === 'loading' && <View style={styles.quotaInline} accessibilityLabel="Cargando cuota de análisis">
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.quotaStateText}>Cargando cuota…</Text>
          </View>}
          {profileStatus === 'error' && <View style={styles.quotaInline}>
            <Text accessibilityRole="alert" style={styles.quotaStateText}>La cuota no está disponible temporalmente.</Text>
            <Pressable onPress={() => void loadMe()} accessibilityRole="button" accessibilityLabel="Reintentar cuota">
              <Text style={styles.recentAction}>Reintentar</Text>
            </Pressable>
          </View>}
          {profileStatus === 'ready' && me && <View style={styles.quotaInline}>
            <Text style={styles.quotaLabel}>Análisis disponibles hoy</Text>
            <Text style={styles.quotaCount}>{me.quota.remaining}<Text style={styles.quotaSmall}> / {me.quota.limit}</Text></Text>
          </View>}
          {!!message && <Alert tone="danger" message={message} />}
          <PrimaryButton label="Analizar enlace" onPress={submit} loading={busy} />
        </View>
        <View style={styles.summarySection} accessibilityLabel="Resumen de análisis, últimos 365 días">
          {summaryLoading ? (
            <View style={styles.summaryState} accessibilityLabel="Cargando métricas de los últimos 365 días">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.summaryStateText}>Cargando métricas…</Text>
            </View>
          ) : summaryError ? (
            <View style={styles.summaryState}>
              <Text accessibilityRole="alert" style={styles.summaryStateText}>{summaryError}</Text>
              <Pressable onPress={() => void loadSummary()} accessibilityRole="button" accessibilityLabel="Reintentar carga de métricas">
                <Text style={styles.recentAction}>Reintentar</Text>
              </Pressable>
            </View>
          ) : summary ? (
            <>
              <View style={styles.summaryRow}>
                <View accessible accessibilityLabel={`Analizados, ${summary.total}, últimos 365 días`} style={styles.summaryMetric}>
                  <Text style={styles.summaryCount}>{summary.total}</Text>
                  <Text style={styles.summaryLabel}>Analizados</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View accessible accessibilityLabel={`Peligrosos, ${summary.dangerous}, últimos 365 días`} style={styles.summaryMetric}>
                  <Text style={[styles.summaryCount, styles.summaryDanger]}>{summary.dangerous}</Text>
                  <Text style={styles.summaryLabel}>Peligrosos</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View accessible accessibilityLabel={`Sospechosos, ${summary.suspicious}, últimos 365 días`} style={styles.summaryMetric}>
                  <Text style={[styles.summaryCount, styles.summaryWarning]}>{summary.suspicious}</Text>
                  <Text style={styles.summaryLabel}>Sospechosos</Text>
                </View>
              </View>
              <Text style={styles.summaryPeriod}>Últimos 365 días</Text>
              {summary.total === 0 && <Text style={styles.summaryStateText}>Sin análisis en este período.</Text>}
            </>
          ) : (
            <View style={styles.summaryState}>
              <Text style={styles.summaryStateText}>No hay métricas disponibles.</Text>
              <Pressable onPress={() => void loadSummary()} accessibilityRole="button"><Text style={styles.recentAction}>Reintentar</Text></Pressable>
            </View>
          )}
        </View>
        <View style={styles.recentSection}>
          <View style={styles.recentHeader}>
            <Text style={styles.recentTitle}>Análisis recientes</Text>
            <Pressable onPress={() => router.push('/history')} accessibilityRole="button" accessibilityLabel="Ver todo el historial" hitSlop={8}>
              <Text style={styles.recentAction}>Ver todo</Text>
            </Pressable>
          </View>
          {recentLoading ? (
            <>
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel="Cargando análisis recientes"
                accessibilityState={{ busy: true }}
                accessibilityLiveRegion="polite"
                style={styles.recentState}
              >
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.recentStateText}>Cargando análisis…</Text>
              </View>
              <View testID="analysis-recent-skeletons" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.recentSkeletons}>
                {[0, 1, 2].map((row) => (
                  <View key={row} style={styles.recentSkeletonRow}>
                    <Skeleton width={34} height={34} radius={8} />
                    <View style={styles.recentSkeletonText}>
                      <Skeleton width="78%" height={14} />
                      <Skeleton width="48%" height={11} />
                    </View>
                    <Skeleton width={74} height={23} radius="pill" />
                  </View>
                ))}
              </View>
            </>
          ) : recentError ? (
            <View style={styles.recentState}>
              <Alert tone="danger" message={recentError} />
              <Pressable onPress={() => void loadRecent()} accessibilityRole="button"><Text style={styles.recentAction}>Reintentar</Text></Pressable>
            </View>
          ) : recent.length === 0 ? (
            <View style={styles.recentEmpty}><Text style={styles.recentStateText}>Tus análisis aparecerán aquí.</Text></View>
          ) : recent.map((item) => {
            const presentation = analysisPresentation(item);
            const active = !item.analysis?.verdict && ['received', 'processing'].includes(item.processingStatus);
            return (
              <Pressable
                key={`${item.localDate}-${item.attemptId}`}
                accessibilityRole="button"
                accessibilityLabel={`Análisis de ${safeHost(item.submittedInput)}, ${presentation.label}, ${recentDate(item.receivedAt)}`}
                accessibilityHint="Abre el resultado del análisis"
                onPress={() => router.push({ pathname: '/analysis/[attemptId]', params: { attemptId: item.attemptId, localDate: item.localDate } })}
                style={({ pressed }) => [styles.recentItem, pressed && styles.recentItemPressed]}
              >
                <View style={styles.recentItemRow}>
                  <View testID={`recent-icon-${item.attemptId}`} style={[styles.recentStatusIcon, { borderColor: presentation.color, backgroundColor: colors.surfaceRaised }]}>
                    {active ? <ActivityIndicator size="small" color={presentation.color} /> : <Text style={[styles.recentStatusIconText, { color: presentation.color }]}>{presentation.icon}</Text>}
                  </View>
                  <View style={styles.recentInfo}>
                    <Text numberOfLines={1} style={styles.recentHost}>{safeHost(item.submittedInput)}</Text>
                    <Text style={styles.recentDate}>{recentDate(item.receivedAt)}</Text>
                  </View>
                  <View testID={`recent-badge-${item.attemptId}`} style={[styles.recentBadge, { borderColor: presentation.color }]}>
                    <Text numberOfLines={1} style={[styles.recentBadgeText, { color: presentation.color }]}>{presentation.label}</Text>
                  </View>
                  <Text style={styles.recentChevron}>›</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.disclaimer}>Los resultados son informativos y no garantizan que un sitio sea seguro.</Text>
      </ScrollView>
      <BottomTabs />
      <NoticeDialog
        visible={noticeType !== null}
        title={noticeType === 'quota' ? 'Límite de análisis alcanzado' : 'Sin conexión'}
        message={noticeType === 'quota'
          ? `${quotaDescription} Puedes volver a intentarlo después del reinicio${quotaReset ? ` a las ${quotaReset} (hora de Ciudad de México)` : ' de tu cuota'}.`
          : 'No pudimos enviar el enlace. Revisa tu conexión e inténtalo de nuevo; el texto permanece en el campo y no se volverá a enviar automáticamente.'}
        tone={noticeType === 'quota' ? 'warning' : 'info'}
        onDismiss={() => setNoticeType(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, padding: 22, paddingBottom: 18 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 50 },
  profileButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 11 },
  profileAvatar: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#172943', borderWidth: 1, borderColor: '#294263' },
  profileAvatarText: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 12 },
  profileGreeting: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 11 },
  profileName: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 14, marginTop: 1 },
  greeting: { marginTop: 22, marginBottom: 14 },
  kicker: { color: colors.primaryText, fontFamily: typefaces.semibold, letterSpacing: 1.3, fontSize: 11, marginBottom: 8 },
  subtitle: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 14, lineHeight: 21, maxWidth: 330 },
  quotaInline: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingTop: 2 },
  quotaLabel: { color: colors.textSecondary, fontFamily: typefaces.medium, fontSize: 11 },
  quotaCount: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 12 },
  quotaSmall: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 11 },
  quotaState: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  quotaStateText: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 11 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderColor: colors.border, borderWidth: 1, padding: 14, gap: 10 },
  summarySection: { marginTop: 22, gap: 8 },
  summaryRow: { flexDirection: 'row', alignItems: 'stretch', justifyContent: 'space-between', paddingVertical: 6 },
  summaryMetric: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 58 },
  summaryCount: { color: colors.text, fontFamily: typefaces.bold, fontSize: 25, lineHeight: 30 },
  summaryDanger: { color: colors.danger },
  summaryWarning: { color: colors.warning },
  summaryLabel: { color: colors.textMuted, fontFamily: typefaces.medium, fontSize: 11, textAlign: 'center' },
  summaryDivider: { width: 1, backgroundColor: colors.border, marginVertical: 2 },
  summaryPeriod: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 10, textAlign: 'center' },
  summaryState: { minHeight: 66, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  summaryStateText: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  inputActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 30 },
  textAction: { minHeight: 34, minWidth: 52, justifyContent: 'center' },
  paste: { color: colors.primaryText, fontFamily: typefaces.semibold, fontSize: 13, paddingHorizontal: 4, paddingVertical: 6 },
  clearText: { color: colors.textMuted, fontFamily: typefaces.medium, fontSize: 12, textAlign: 'right', paddingVertical: 6 },
  disabledTextAction: { opacity: 0.45 },
  characterCount: { flex: 1, color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 10, textAlign: 'right', marginRight: 12 },
  input: { minHeight: 134, borderRadius: radius.sm, borderWidth: 1, borderColor: '#304461', backgroundColor: colors.surfaceInput, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10, color: colors.text, fontFamily: typefaces.regular, fontSize: 13, lineHeight: 19 },
  helper: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 11, lineHeight: 16 },
  resultCard: { marginTop: 18, padding: 18, borderRadius: radius.lg, backgroundColor: '#111E32', borderWidth: 1, borderColor: colors.border, gap: 12 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  status: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 16 },
  resultBody: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 13, lineHeight: 20 },
  reason: { color: colors.text, fontFamily: typefaces.regular, fontSize: 13, lineHeight: 19 },
  pollNote: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 12, lineHeight: 17 },
  retry: { color: '#6EA2FF', fontFamily: typefaces.semibold, fontSize: 13 },
  retryBlock: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  retryButton: { minHeight: 38, justifyContent: 'center' },
  recentSection: { marginTop: 26, gap: 10 },
  recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  recentTitle: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 17 },
  recentAction: { color: colors.primaryText, fontFamily: typefaces.semibold, fontSize: 12, paddingVertical: 5 },
  recentState: { minHeight: 72, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  recentStateText: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  recentSkeletons: { gap: 8 },
  recentSkeletonRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 13, paddingVertical: 12 },
  recentSkeletonText: { flex: 1, gap: 7 },
  recentEmpty: { minHeight: 64, alignItems: 'center', justifyContent: 'center', padding: 14, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  recentItem: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  recentItemPressed: { opacity: 0.78 },
  recentItemRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  recentStatusIcon: { width: 34, height: 34, borderRadius: radius.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  recentStatusIconText: { fontFamily: typefaces.bold, fontSize: 15 },
  recentInfo: { flex: 1, minWidth: 0, gap: 3 },
  recentHost: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 13 },
  recentChevron: { color: colors.textMuted, fontSize: 21, lineHeight: 23 },
  recentDate: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 10 },
  recentBadge: { maxWidth: 128, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  recentBadgeText: { fontFamily: typefaces.semibold, fontSize: 9 },
  disclaimer: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 20 },
});
