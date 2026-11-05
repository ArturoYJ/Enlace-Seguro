import { useState } from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AuthField } from '../../components/AuthField';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useSession } from '../../lib/session';
import { registerErrorMessage } from '../../lib/authErrorMessage';
import { colors, radius, typefaces } from '../../theme/tokens';

export default function RegisterScreen() {
  const router = useRouter();
  const { signUp } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setError('');
    if (!email.trim() || !password) { setError('Completa tu correo y contraseña.'); return; }
    if (password.length < 8 || password.length > 128) { setError('La contraseña debe tener entre 8 y 128 caracteres.'); return; }
    setBusy(true);
    try {
      await signUp(email.trim(), password);
      router.replace({ pathname: '/auth/login', params: { registered: '1' } });
    } catch (cause) {
      setError(registerErrorMessage(cause));
    } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Volver" style={styles.back}><Text style={styles.backText}>‹</Text></Pressable>
        <View style={styles.hero}>
          <Text style={styles.kicker}>ENLACESEGURO</Text>
          <Text accessibilityRole="header" style={styles.title}>Crea tu cuenta</Text>
          <Text style={styles.subtitle}>Guarda tu historial y consulta tus análisis.</Text>
        </View>
        <View style={styles.form}>
          <AuthField label="Correo electrónico" placeholder="tu@correo.com" value={email} onChangeText={setEmail} keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" />
          <AuthField label="Contraseña" placeholder="Entre 8 y 128 caracteres" value={password} onChangeText={setPassword} secret textContentType="newPassword" returnKeyType="done" onSubmitEditing={submit} />
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <PrimaryButton label="Crear cuenta" onPress={submit} loading={busy} />
        </View>
        <View style={styles.bottom}>
          <Text style={styles.prompt}>¿Ya tienes cuenta? </Text>
          <Pressable onPress={() => router.replace('/auth/login')} accessibilityRole="link"><Text style={styles.link}>Inicia sesión</Text></Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 28 },
  back: { width: 42, height: 42, justifyContent: 'center' },
  backText: { color: colors.text, fontSize: 34, lineHeight: 38 },
  hero: { marginTop: 34, marginBottom: 34 },
  kicker: { color: colors.primaryText, fontFamily: typefaces.semibold, letterSpacing: 1.4, fontSize: 11, marginBottom: 12 },
  title: { color: colors.text, fontFamily: typefaces.bold, fontSize: 29, letterSpacing: -0.4 },
  subtitle: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 14, marginTop: 8 },
  form: { gap: 18 },
  error: { color: '#FF9BAA', backgroundColor: '#3A202B', borderRadius: radius.sm, padding: 12, fontFamily: typefaces.medium, fontSize: 13, lineHeight: 19 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  prompt: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 14 },
  link: { color: '#6EA2FF', fontFamily: typefaces.semibold, fontSize: 14 },
});
