import { useState } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { AuthField } from '../../components/AuthField';
import { BrandShield } from '../../components/BrandShield';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useSession } from '../../lib/session';
import { loginErrorMessage } from '../../lib/authErrorMessage';
import { colors, radius, typefaces } from '../../theme/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const { registered } = useLocalSearchParams<{ registered?: string }>();
  const { signIn, sessionNotice } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!email.trim() || !password) { setError('Escribe tu correo y contraseña para continuar.'); return; }
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      router.replace('/analysis');
    } catch (cause) {
      setError(loginErrorMessage(cause));
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Volver" style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
        <View style={styles.hero}>
          <View style={styles.mark}><BrandShield size={42} /></View>
          <Text style={styles.title}>Inicia sesión</Text>
          <Text style={styles.subtitle}>Analiza enlaces sospechosos sin abrirlos.</Text>
        </View>
        <View style={styles.form}>
          {registered === '1' && <Text style={styles.success}>Tu cuenta quedó creada. Inicia sesión para continuar.</Text>}
          {!!sessionNotice && <Text accessibilityRole="alert" style={styles.notice}>{sessionNotice}</Text>}
          <AuthField label="Correo electrónico" placeholder="tucorreo@ejemplo.com" leadingIcon="mail" value={email} onChangeText={setEmail} keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" />
          <AuthField label="Contraseña" placeholder="••••••••" leadingIcon="lock" value={password} onChangeText={setPassword} secret textContentType="password" returnKeyType="done" onSubmitEditing={submit} />
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <PrimaryButton label="Iniciar sesión" onPress={submit} loading={busy} />
        </View>
        <View style={styles.bottom}>
          <Text style={styles.prompt}>¿Aún no tienes cuenta? </Text>
          <Pressable onPress={() => router.push('/auth/register')} accessibilityRole="link"><Text style={styles.link}>Crear cuenta</Text></Pressable>
        </View>
        <View style={styles.privacy}>
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Rect x="5" y="10" width="14" height="11" rx="2" stroke={colors.textMuted} strokeWidth="1.7" />
            <Path d="M8 10V7a4 4 0 0 1 8 0v3" stroke={colors.textMuted} strokeWidth="1.7" strokeLinecap="round" />
          </Svg>
          <Text style={styles.privacyText}>Tu sesión se guarda cifrada en este dispositivo.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },
  back: { width: 42, height: 42, alignItems: 'flex-start', justifyContent: 'center' },
  backText: { color: colors.text, fontSize: 34, lineHeight: 38 },
  hero: { alignItems: 'center', marginTop: 26, marginBottom: 34 },
  mark: { width: 72, height: 72, borderRadius: 22, backgroundColor: '#122442', alignItems: 'center', justifyContent: 'center', marginBottom: 22, borderWidth: 1, borderColor: '#263D62' },
  title: { color: colors.text, fontFamily: typefaces.bold, fontSize: 28, letterSpacing: -0.35 },
  subtitle: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 14, lineHeight: 21, marginTop: 8, textAlign: 'center' },
  form: { gap: 18 },
  error: { color: '#FF9BAA', backgroundColor: '#3A202B', borderRadius: radius.sm, padding: 12, fontFamily: typefaces.medium, fontSize: 13, lineHeight: 19 },
  success: { color: '#82E2BB', backgroundColor: '#14372F', borderRadius: radius.sm, padding: 12, fontFamily: typefaces.medium, fontSize: 13, lineHeight: 19 },
  notice: { color: colors.textSecondary, backgroundColor: colors.surface, borderRadius: radius.sm, padding: 12, fontFamily: typefaces.medium, fontSize: 13, lineHeight: 19 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  prompt: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 14 },
  link: { color: '#6EA2FF', fontFamily: typefaces.semibold, fontSize: 14 },
  privacy: { marginTop: 'auto', paddingTop: 34, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  privacyText: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 12 },
});
