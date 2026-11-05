import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomTabs } from '../components/BottomTabs';
import { BrandWordmark } from '../components/BrandWordmark';
import { Alert } from '../components/Alert';
import { safeApiErrorMessage } from '../lib/safeApiErrorMessage';
import { Skeleton } from '../components/Skeleton';
import { authenticatedRequest, useSession } from '../lib/session';
import { analysisPresentation } from '../lib/analysisPresentation';
import { colors, radius, typefaces } from '../theme/tokens';

type HistoryItem = {
  attemptId: string;
  localDate: string;
  receivedAt: string;
  processingStatus: string;
  submittedInput?: string;
  analysis?: { verdict?: string; reasons?: string[] };
};
type HistoryPage = { items: HistoryItem[]; hasMore: boolean; nextCursor: string | null };

function safeHost(input?: string): string {
  if (!input) return 'Enlace analizado';
  try {
    const url = new URL(input);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.hostname : 'Enlace analizado';
  } catch { return 'Enlace analizado'; }
}

function formattedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(date);
}

export default function HistoryScreen() {
  const router = useRouter();
  const { ready, accessToken, sessionExpired } = useSession();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestActive = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => { if (ready && !accessToken) router.replace(sessionExpired ? '/auth/session-expired' : '/auth/login'); }, [ready, accessToken, sessionExpired, router]);

  const load = useCallback(async (cursor?: string | null) => {
    if (requestActive.current) return;
    requestActive.current = true;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setError('');
    if (cursor) setLoadingMore(true); else setLoading(true);
    try {
      const query = new URLSearchParams({ limit: '10' });
      if (cursor) query.set('cursor', cursor);
      const page = await authenticatedRequest<HistoryPage>(`/analyses?${query.toString()}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setItems((current) => {
        const combined = cursor ? [...current, ...page.items] : page.items;
        return [...new Map(combined.map((item) => [`${item.localDate}:${item.attemptId}`, item])).values()];
      });
      setHasMore(page.hasMore && Boolean(page.nextCursor));
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (!controller.signal.aborted) setError(safeApiErrorMessage(cause, 'No pudimos cargar tu historial.'));
    } finally {
      requestActive.current = false;
      if (controllerRef.current === controller) controllerRef.current = null;
      setLoading(false); setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    const timer = setTimeout(() => { void load(null); }, 0);
    return () => { clearTimeout(timer); controllerRef.current?.abort(); };
  }, [accessToken, load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.page}>
        <View style={styles.header}><BrandWordmark compact /><Text style={styles.headerLabel}>Tu actividad</Text></View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.kicker}>ANÁLISIS RECIENTES</Text>
          <Text accessibilityRole="header" style={styles.title}>Historial</Text>
          <Text style={styles.subtitle}>Consulta los análisis asociados a tu cuenta.</Text>
          {!!error && <View style={styles.errorCard}><Alert tone="danger" message={error} /><Pressable accessibilityRole="button" onPress={() => void load(null)}><Text style={styles.action}>Volver a intentar</Text></Pressable></View>}
          {loading ? (
            <View style={styles.loading}>
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel="Cargando historial"
                accessibilityState={{ busy: true }}
                accessibilityLiveRegion="polite"
                style={styles.loadingAnnouncement}
              >
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.emptyText}>Cargando historial…</Text>
              </View>
              <View testID="history-skeletons" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.historySkeletons}>
                {[0, 1, 2, 3].map((row) => (
                  <View key={row} style={styles.historySkeletonCard}>
                    <View style={styles.historySkeletonTitle}>
                      <Skeleton width={24} height={24} radius={8} />
                      <Skeleton width="62%" height={15} />
                      <Skeleton width={12} height={16} radius="pill" />
                    </View>
                    <Skeleton width="34%" height={11} />
                    <Skeleton width={92} height={22} radius="pill" />
                  </View>
                ))}
              </View>
            </View>
          ) : !error && items.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyMark}><Text style={styles.emptyMarkText}>↗</Text></View>
              <Text style={styles.emptyTitle}>Aún no tienes análisis</Text>
              <Text style={styles.emptyText}>Cuando revises un enlace, aparecerá aquí.</Text>
              <Pressable accessibilityRole="button" onPress={() => router.replace('/analysis')} style={styles.emptyButton}><Text style={styles.action}>Analizar un enlace</Text></Pressable>
            </View>
          ) : (
            <View style={styles.list}>
              {items.map((item) => {
                const presentation = analysisPresentation(item);
                const active = !item.analysis?.verdict && ['received', 'processing'].includes(item.processingStatus);
                return (
                  <Pressable
                    key={`${item.localDate}-${item.attemptId}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Análisis de ${safeHost(item.submittedInput)}, ${presentation.label}, ${formattedDate(item.receivedAt)}`}
                    onPress={() => router.push({ pathname: '/analysis/[attemptId]', params: { attemptId: item.attemptId, localDate: item.localDate } })}
                    style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                  >
                    <View style={styles.itemTop}>
                      <View style={styles.itemTitleGroup}>
                        <View testID={`history-icon-${item.attemptId}`} style={[styles.statusIcon, { borderColor: presentation.color, backgroundColor: colors.surfaceRaised }]}>
                          {active
                            ? <ActivityIndicator testID={`history-spinner-${item.attemptId}`} size="small" color={presentation.color} />
                            : <Text testID={`history-symbol-${item.attemptId}`} style={[styles.statusIconText, { color: presentation.color }]}>{presentation.icon}</Text>}
                        </View>
                        <Text numberOfLines={1} style={styles.domain}>{safeHost(item.submittedInput)}</Text>
                      </View>
                      <Text style={styles.chevron}>›</Text>
                    </View>
                    <Text style={styles.date}>{formattedDate(item.receivedAt)}</Text>
                    <View testID={`history-badge-${item.attemptId}`} style={[styles.tag, { borderColor: presentation.color }]}><Text style={[styles.tagText, { color: presentation.color }]}>{presentation.label}</Text></View>
                  </Pressable>
                );
              })}
              {hasMore && <Pressable accessibilityRole="button" onPress={() => void load(nextCursor)} disabled={loadingMore} style={styles.moreButton}>{loadingMore ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.action}>Cargar más</Text>}</Pressable>}
              {!hasMore && items.length > 0 && <Text style={styles.endLabel}>Mostrando tus análisis recientes.</Text>}
            </View>
          )}
        </ScrollView>
      </View>
      <BottomTabs />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1 },
  header: { height: 54, paddingHorizontal: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLabel: { color: colors.textSecondary, fontFamily: typefaces.medium, fontSize: 13 },
  content: { padding: 22, paddingTop: 26, paddingBottom: 30 },
  kicker: { color: colors.primaryText, fontFamily: typefaces.semibold, fontSize: 11, letterSpacing: 1.4, marginBottom: 8 },
  title: { color: colors.text, fontFamily: typefaces.bold, fontSize: 28, letterSpacing: -0.4 },
  subtitle: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 14, lineHeight: 21, marginTop: 7, marginBottom: 22 },
  list: { gap: 12 },
  item: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 15, paddingVertical: 14, gap: 9 },
  itemPressed: { opacity: 0.78 },
  itemTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  itemTitleGroup: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  statusIcon: { width: 24, height: 24, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  statusIconText: { fontFamily: typefaces.bold, fontSize: 13, lineHeight: 16 },
  domain: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 15, flexShrink: 1 },
  chevron: { color: colors.textMuted, fontSize: 24, lineHeight: 25 },
  date: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 11, marginLeft: 18 },
  tag: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, paddingHorizontal: 10, paddingVertical: 5, marginLeft: 34 },
  tagText: { fontFamily: typefaces.medium, fontSize: 11 },
  emptyCard: { marginTop: 28, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, alignItems: 'center', padding: 24 },
  emptyMark: { width: 52, height: 52, borderRadius: 18, backgroundColor: '#122442', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyMarkText: { color: colors.primary, fontSize: 27 },
  emptyTitle: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 17 },
  emptyText: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 7 },
  emptyButton: { marginTop: 18, padding: 10 },
  action: { color: colors.primaryText, fontFamily: typefaces.semibold, fontSize: 13 },
  loading: { gap: 12 },
  loadingAnnouncement: { padding: 14, alignItems: 'center', gap: 12 },
  historySkeletons: { gap: 12 },
  historySkeletonCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 15, paddingVertical: 14, gap: 10 },
  historySkeletonTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  errorCard: { backgroundColor: '#3A202B', borderRadius: radius.md, padding: 14, gap: 10, marginBottom: 16 },
  moreButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  endLabel: { textAlign: 'center', color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 11, paddingVertical: 10 },
});
