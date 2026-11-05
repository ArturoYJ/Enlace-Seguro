import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from '@expo-google-fonts/ibm-plex-sans';
import { colors, typefaces } from '../theme/tokens';
import { SessionProvider } from '../lib/session';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    [typefaces.regular]: IBMPlexSans_400Regular,
    [typefaces.medium]: IBMPlexSans_500Medium,
    [typefaces.semibold]: IBMPlexSans_600SemiBold,
    [typefaces.bold]: IBMPlexSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.lang = 'es-MX';
    }
  }, []);

  if (!fontsLoaded) return null;

  return (
    <>
      <Head>
        <title>EnlaceSeguro</title>
        <meta name="description" content="Analiza enlaces sospechosos sin abrirlos." />
      </Head>
      <SessionProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="auth/login" />
          <Stack.Screen name="auth/register" />
          <Stack.Screen name="auth/session-expired" />
          <Stack.Screen name="analysis" />
          <Stack.Screen name="history" />
          <Stack.Screen name="account" />
          <Stack.Screen name="analysis/[attemptId]" />
        </Stack>
      </SessionProvider>
    </>
  );
}
