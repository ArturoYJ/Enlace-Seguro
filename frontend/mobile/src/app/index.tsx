import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import type { Metadata } from 'expo-router/server';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BrandWordmark } from '../components/BrandWordmark';
import { OnboardingIllustration } from '../components/OnboardingIllustration';
import { PrimaryButton } from '../components/PrimaryButton';
import { useSession } from '../lib/session';
import { colors, radius, space, typefaces } from '../theme/tokens';

export function generateMetadata(): Metadata {
  return { title: 'EnlaceSeguro', description: 'Analiza enlaces sospechosos sin abrirlos.' };
}

const slides = [
  {
    eyebrow: 'NAVEGA CON MÁS CONFIANZA',
    title: '¿Te llegó un enlace sospechoso?',
    body: 'Los mensajes falsos pueden parecer reales. No necesitas abrir el enlace para revisarlo.',
  },
  {
    eyebrow: 'ANÁLISIS AISLADO',
    title: 'Lo revisamos por ti',
    body: 'EnlaceSeguro analiza la página en un entorno separado para que no tengas que visitarla desde tu dispositivo.',
  },
  {
    eyebrow: 'INFORMACIÓN CLARA',
    title: 'Recibe un resultado fácil de entender',
    body: 'Consulta las señales observadas y decide con más contexto. Ningún análisis garantiza que un sitio sea seguro.',
  },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const { ready, accessToken, sessionExpired, sessionNotice, sessionRestoreRetryable, sessionRestorePending, retrySessionRestore } = useSession();
  const [step, setStep] = useState(0);
  const { height } = useWindowDimensions();
  const compact = height < 760;
  const slide = slides[step];

  useEffect(() => {
    if (ready && accessToken) router.replace('/analysis');
    else if (ready && sessionExpired) router.replace('/auth/session-expired');
  }, [ready, accessToken, sessionExpired, router]);

  const continueFlow = () => {
    if (step < slides.length - 1) setStep((current) => current + 1);
    else router.push('/auth/login');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <BrandWordmark />
        <Pressable accessibilityRole="button" onPress={() => router.push('/auth/login')} hitSlop={12}>
          <Text style={styles.skip}>Omitir</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
        <View style={[styles.illustration, compact && styles.illustrationCompact]}>
          <OnboardingIllustration step={step} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{slide.eyebrow}</Text>
          <Text accessibilityRole="header" style={styles.title}>{slide.title}</Text>
          <Text style={styles.body}>{slide.body}</Text>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        {sessionRestoreRetryable && !!sessionNotice && (
          <View style={styles.restoreNotice}>
            <Text accessibilityRole="alert" style={styles.restoreMessage}>{sessionNotice}</Text>
            <PrimaryButton label="Reintentar sesión" onPress={() => { void retrySessionRestore(); }} loading={sessionRestorePending} />
          </View>
        )}
        <View
          style={styles.pagination}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={`Pantalla ${step + 1} de ${slides.length}`}
          accessibilityValue={{ min: 1, max: slides.length, now: step + 1 }}
        >
          {slides.map((item, index) => (
            <View key={item.eyebrow} style={[styles.dot, index === step && styles.activeDot]} />
          ))}
        </View>
        <PrimaryButton label={step === slides.length - 1 ? 'Comenzar' : 'Continuar'} onPress={continueFlow} />
        {step === slides.length - 1 && (
          <Text style={styles.disclaimer}>Los resultados son informativos y pueden no detectar todas las amenazas.</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 24 },
  header: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skip: { color: colors.textSecondary, fontFamily: typefaces.medium, fontSize: 14 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingBottom: space.md },
  illustration: { width: '100%', height: 270, marginTop: 6, marginBottom: 18, alignSelf: 'center', maxWidth: 370 },
  illustrationCompact: { height: 220, marginBottom: 8 },
  copy: { alignItems: 'center', paddingHorizontal: 4 },
  eyebrow: { color: colors.primaryText, fontFamily: typefaces.semibold, fontSize: 11, letterSpacing: 1.6, marginBottom: 12 },
  title: { color: colors.text, fontFamily: typefaces.bold, fontSize: 28, lineHeight: 35, textAlign: 'center', letterSpacing: -0.4, maxWidth: 330 },
  body: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 12, maxWidth: 328 },
  footer: { paddingTop: 12, paddingBottom: 12, gap: 16 },
  pagination: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, height: 8 },
  dot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: '#34445E' },
  activeDot: { width: 22, backgroundColor: colors.primary },
  disclaimer: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: -6 },
  restoreNotice: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, padding: space.md, gap: space.sm },
  restoreMessage: { color: colors.textSecondary, fontFamily: typefaces.medium, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
