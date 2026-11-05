import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandShield } from '../../components/BrandShield';
import { BrandWordmark } from '../../components/BrandWordmark';
import { PrimaryButton } from '../../components/PrimaryButton';
import { colors, radius, space, typefaces } from '../../theme/tokens';

export default function SessionExpiredScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}><BrandWordmark compact /></View>
        <View style={styles.content}>
          <View style={styles.mark}><BrandShield size={42} /></View>
          <Text style={styles.kicker}>SESIÓN FINALIZADA</Text>
          <Text accessibilityRole="header" style={styles.title}>Tu sesión expiró</Text>
          <Text style={styles.description}>
            Por seguridad, cerramos tu sesión. Inicia sesión nuevamente para continuar revisando enlaces.
          </Text>
          <View style={styles.actions}>
            <PrimaryButton label="Iniciar sesión" onPress={() => router.replace('/auth/login')} />
            <Pressable
              accessibilityRole="link"
              onPress={() => router.replace('/')}
              style={styles.secondaryAction}
            >
              <Text style={styles.secondaryLabel}>Volver al inicio</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.footnote}>
          <Text style={styles.footnoteText}>Tu cuenta y tus análisis permanecen protegidos.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.backgroundDeep },
  container: { flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.xl },
  header: { minHeight: 46, justifyContent: 'center' },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: space.xxxl },
  mark: { width: 76, height: 76, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: space.xl },
  kicker: { color: colors.primaryText, fontFamily: typefaces.semibold, fontSize: 11, letterSpacing: 1.5, marginBottom: space.sm },
  title: { color: colors.text, fontFamily: typefaces.bold, fontSize: 27, letterSpacing: -0.35, textAlign: 'center' },
  description: { maxWidth: 330, color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: space.md },
  actions: { width: '100%', maxWidth: 360, gap: space.md, marginTop: space.xxl },
  secondaryAction: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryLabel: { color: colors.textSecondary, fontFamily: typefaces.medium, fontSize: 14 },
  footnote: { alignItems: 'center', paddingTop: space.lg },
  footnoteText: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 12, textAlign: 'center' },
});
