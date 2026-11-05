import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomTabs } from '../components/BottomTabs';
import { BrandShield } from '../components/BrandShield';
import { BrandWordmark } from '../components/BrandWordmark';
import { Alert } from '../components/Alert';
import { DevDesignSystemShowcase } from '../components/DevDesignSystemShowcase';
import { PrimaryButton } from '../components/PrimaryButton';
import { Skeleton } from '../components/Skeleton';
import { safeApiErrorMessage } from '../lib/safeApiErrorMessage';
import { authenticatedRequest, useSession } from '../lib/session';
import { colors, radius, typefaces } from '../theme/tokens';

type Me = {
  user: { id: string; email: string; role: 'admin' | 'usuario'; accountStatus: string; createdAt: string };
  quota: { localDate: string; timezone: string; limit: number; used: number; remaining: number; resetAt: string };
};
type Summary = { total: number; dangerous: number; suspicious: number };

function resetTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Hora no disponible';
  return new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Mexico_City' }).format(date);
}

function memberSince(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha de registro no disponible';
  return `Miembro desde ${new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' }).format(date)}`;
}

function DevDesignSystemEntry() {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Abrir showcase del sistema de diseño" onPress={() => setVisible(true)} style={styles.devShowcaseButton}>
        <Text style={styles.devShowcaseLabel}>Vista previa del sistema de diseño</Text>
      </Pressable>
      <DevDesignSystemShowcase visible={visible} onClose={() => setVisible(false)} />
    </>
  );
}

export default function AccountScreen() {
  const router = useRouter();
  const { ready, accessToken, sessionExpired, signOut, sessionNotice } = useSession();
  const [profile, setProfile] = useState<Me | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [summaryRetry, setSummaryRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutConfirmVisible, setLogoutConfirmVisible] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => { if (ready && !accessToken) router.replace(sessionExpired ? '/auth/session-expired' : '/auth/login'); }, [ready, accessToken, sessionExpired, router]);
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    async function loadProfile() {
      try {
        const data = await authenticatedRequest<Me>('/auth/me');
        if (active) setProfile(data);
      } catch (cause) { if (active) setError(safeApiErrorMessage(cause, 'No pudimos cargar tu cuenta. Inténtalo de nuevo.')); }
      finally { if (active) setLoading(false); }
    }
    void loadProfile();
    return () => { active = false; };
  }, [accessToken, retryCount]);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void authenticatedRequest<Summary>('/analyses/summary')
      .then((data) => { if (active) setSummary(data); })
      .catch(() => { if (active) setSummaryError('No pudimos cargar tus estadísticas.'); });
    return () => { active = false; };
  }, [accessToken, summaryRetry]);

  function retryProfile() {
    setLoading(true);
    setError('');
    setRetryCount((current) => current + 1);
  }

  function retrySummary() {
    setSummaryError('');
    setSummaryRetry((value) => value + 1);
  }

  async function confirmLogout() {
    setLogoutConfirmVisible(false);
    setLogoutBusy(true);
    try { await signOut(); }
    catch { /* local session is already cleared; login screen shows the revocation warning */ }
    finally { setLogoutBusy(false); router.replace('/auth/login'); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.page}>
        <View style={styles.header}><BrandWordmark compact /><Text style={styles.headerLabel}>Cuenta</Text></View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text accessibilityRole="header" style={styles.title}>Mi cuenta</Text>
          {loading ? (
            <View style={styles.loading}>
              <View
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel="Cargando tu cuenta"
                accessibilityState={{ busy: true }}
                accessibilityLiveRegion="polite"
                style={styles.loadingAnnouncement}
              >
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.secondary}>Cargando tu cuenta…</Text>
              </View>
              <View testID="account-skeleton" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.accountSkeleton}>
                <View style={styles.profileSkeleton}>
                  <Skeleton width={54} height={54} radius="md" />
                  <View style={styles.profileSkeletonText}>
                    <Skeleton width="70%" height={16} />
                    <Skeleton width="88%" height={13} />
                    <Skeleton width="46%" height={11} />
                  </View>
                </View>
                <View style={styles.summarySkeleton}>
                  {[0, 1, 2].map((item) => <Skeleton key={item} width="30%" height={68} radius="md" />)}
                </View>
                <Skeleton width="100%" height={96} radius="md" />
              </View>
            </View>
          ) : error ? (
            <View style={styles.errorCard}>
              <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
              <Pressable onPress={retryProfile} accessibilityRole="button" accessibilityLabel="Volver a intentar cargar la cuenta">
                <Text style={styles.action}>Volver a intentar</Text>
              </Pressable>
              <Pressable onPress={() => router.replace('/auth/login')} accessibilityRole="button">
                <Text style={styles.secondaryAction}>Volver al acceso</Text>
              </Pressable>
            </View>
          ) : profile && (
            <>
              <View style={styles.profileCard}>
                <View style={styles.avatar}><BrandShield size={34} /></View>
                <View style={styles.identity}>
                  <Text style={styles.profileName}>Tu cuenta EnlaceSeguro</Text>
                  <Text style={styles.email}>{profile.user.email}</Text>
                  <Text style={styles.member}>{memberSince(profile.user.createdAt)}</Text>
                </View>
              </View>
              <View style={styles.section}>
                <View style={styles.summaryHeading}>
                  <Text style={styles.sectionTitle}>Resumen de análisis</Text>
                  <Text style={styles.period}>Últimos 365 días</Text>
                </View>
                {summaryError ? (
                  <View style={styles.summaryError}>
                    <Alert tone="danger" message={summaryError} />
                    <Pressable accessibilityRole="button" onPress={retrySummary}>
                      <Text style={styles.action}>Volver a intentar</Text>
                    </Pressable>
                  </View>
                ) : summary ? (
                  <View style={styles.statsRow}>
                    <View style={styles.statCard}><Text style={styles.statValue}>{summary.total}</Text><Text style={styles.statLabel}>Solicitudes</Text></View>
                    <View style={styles.statCard}><Text style={[styles.statValue, styles.dangerValue]}>{summary.dangerous}</Text><Text style={styles.statLabel}>Peligrosos</Text></View>
                    <View style={styles.statCard}><Text style={[styles.statValue, styles.warningValue]}>{summary.suspicious}</Text><Text style={styles.statLabel}>Sospechosos</Text></View>
                  </View>
                ) : <Text style={styles.secondary}>Cargando estadísticas…</Text>}
                {!!summary && <Text style={styles.statsHint}>El total incluye solicitudes en cualquier estado; peligrosos y sospechosos requieren veredicto registrado.</Text>}
              </View>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Uso de hoy</Text>
                <View style={styles.quotaRow}>
                  <View><Text style={styles.secondary}>Análisis disponibles</Text><Text style={styles.quotaHint}>Se reinicia a las {resetTime(profile.quota.resetAt)} (hora de Ciudad de México)</Text></View>
                  <Text style={styles.quotaNumber}>{profile.quota.remaining}<Text style={styles.quotaTotal}>/{profile.quota.limit}</Text></Text>
                </View>
                <View style={styles.track}><View style={[styles.fill, { width: `${profile.quota.limit ? Math.min(100, (profile.quota.used / profile.quota.limit) * 100) : 0}%` }]} /></View>
              </View>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Acerca de EnlaceSeguro</Text>
                <Text style={styles.secondary}>Los resultados reflejan las señales disponibles durante cada análisis. Un resultado sin amenazas detectadas no garantiza que un enlace sea seguro.</Text>
                <Text style={styles.secondary}>Tu sesión se conserva en el almacenamiento seguro del dispositivo. El historial muestra el dominio, no la ruta ni los parámetros del enlace.</Text>
                {__DEV__ ? <DevDesignSystemEntry /> : null}
              </View>
              {!!sessionNotice && <Text style={styles.notice}>{sessionNotice}</Text>}
              <PrimaryButton label="Cerrar sesión" onPress={() => setLogoutConfirmVisible(true)} loading={logoutBusy} />
            </>
          )}
        </ScrollView>
      </View>
      <BottomTabs />
      <Modal
        animationType="fade"
        transparent
        visible={logoutConfirmVisible}
        onRequestClose={() => setLogoutConfirmVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View accessibilityRole="alert" accessibilityViewIsModal style={styles.confirmCard}>
            <Text accessibilityRole="header" style={styles.confirmTitle}>¿Cerrar sesión?</Text>
            <Text style={styles.confirmBody}>Tendrás que volver a ingresar para usar tu cuenta en este dispositivo.</Text>
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setLogoutConfirmVisible(false)}
                style={styles.cancelButton}
              >
                <Text style={styles.cancelLabel}>Cancelar</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Confirmar cierre de sesión"
                accessibilityState={{ disabled: logoutBusy, busy: logoutBusy }}
                disabled={logoutBusy}
                onPress={() => void confirmLogout()}
                style={styles.logoutButton}
              >
                <Text style={styles.logoutLabel}>{logoutBusy ? 'Cerrando sesión…' : 'Cerrar sesión'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1 },
  header: { height: 54, paddingHorizontal: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLabel: { color: colors.textSecondary, fontFamily: typefaces.medium, fontSize: 13 },
  content: { padding: 22, paddingTop: 26, gap: 16, paddingBottom: 30 },
  title: { color: colors.text, fontFamily: typefaces.bold, fontSize: 28, letterSpacing: -0.4 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 18 },
  avatar: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#122442', borderWidth: 1, borderColor: '#263D62', alignItems: 'center', justifyContent: 'center' },
  identity: { flex: 1 },
  email: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 14 },
  profileName: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 16, marginBottom: 4 },
  member: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 12, marginTop: 5 },
  section: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 18, gap: 14 },
  sectionTitle: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 15 },
  summaryHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  period: { color: colors.textMuted, fontFamily: typefaces.medium, fontSize: 11 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, minHeight: 76, justifyContent: 'center', alignItems: 'center', gap: 5, backgroundColor: colors.surfaceRaised, borderRadius: radius.md, paddingHorizontal: 6, paddingVertical: 10 },
  statValue: { color: colors.text, fontFamily: typefaces.bold, fontSize: 20 },
  statLabel: { color: colors.textSecondary, fontFamily: typefaces.medium, fontSize: 12, textAlign: 'center' },
  statsHint: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 11, lineHeight: 16 },
  dangerValue: { color: colors.danger },
  warningValue: { color: colors.warning },
  summaryError: { gap: 8 },
  quotaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  secondary: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 13, lineHeight: 20 },
  quotaHint: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 10, lineHeight: 16, marginTop: 4, maxWidth: 235 },
  quotaNumber: { color: colors.text, fontFamily: typefaces.bold, fontSize: 25 },
  quotaTotal: { color: colors.textMuted, fontFamily: typefaces.medium, fontSize: 14 },
  track: { height: 5, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  fill: { height: 5, borderRadius: radius.pill, backgroundColor: colors.primary },
  loading: { paddingTop: 26, gap: 16 },
  loadingAnnouncement: { alignItems: 'center', gap: 12 },
  accountSkeleton: { gap: 12 },
  profileSkeleton: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  profileSkeletonText: { flex: 1, gap: 7 },
  summarySkeleton: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  errorCard: { backgroundColor: '#3A202B', borderRadius: radius.md, padding: 14, gap: 10 },
  error: { color: '#FF9BAA', fontFamily: typefaces.medium, fontSize: 13, lineHeight: 19 },
  action: { color: colors.primaryText, fontFamily: typefaces.semibold, fontSize: 13 },
  secondaryAction: { color: colors.textSecondary, fontFamily: typefaces.medium, fontSize: 13 },
  notice: { color: colors.textSecondary, backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, fontFamily: typefaces.regular, fontSize: 12, lineHeight: 18 },
  devShowcaseButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12 },
  devShowcaseLabel: { color: colors.primaryText, fontFamily: typefaces.semibold, fontSize: 12 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', padding: 16, backgroundColor: 'rgba(10, 18, 32, 0.78)' },
  confirmCard: { width: '100%', maxWidth: 420, alignSelf: 'center', padding: 22, paddingBottom: 30, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 14 },
  confirmTitle: { color: colors.text, fontFamily: typefaces.bold, fontSize: 20, lineHeight: 27 },
  confirmBody: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 14, lineHeight: 21 },
  confirmActions: { gap: 8, marginTop: 4 },
  cancelButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  cancelLabel: { color: colors.textSecondary, fontFamily: typefaces.semibold, fontSize: 14 },
  logoutButton: { minHeight: 54, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: '#A93449', paddingHorizontal: 20 },
  logoutLabel: { color: colors.white, fontSize: 15, fontFamily: typefaces.semibold, letterSpacing: 0.2 },
});
