import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { apiUrl } from '../lib/session';
import { colors, radius, typefaces } from '../theme/tokens';

type Props = { attemptId: string; accessToken: string };
type Status = 'loading' | 'ready' | 'hidden';

// El padre la monta con key={attemptId}, así el estado se reinicia por análisis.
// La API responde 404 cuando no hay captura o el proxy está apagado; en ese caso la sección no se muestra.
export function AnalysisCapture({ attemptId, accessToken }: Props) {
  const [status, setStatus] = useState<Status>('loading');

  let uri: string;
  try { uri = apiUrl(`/analyses/${encodeURIComponent(attemptId)}/capture`); } catch { return null; }
  if (status === 'hidden') return null;

  return (
    <View style={styles.section} testID="analysis-capture">
      <Text style={styles.title}>Captura del sitio</Text>
      <Text style={styles.helper}>Tomada dentro del entorno aislado. No abras el enlace para comprobarlo.</Text>
      <View style={styles.frame}>
        {status === 'loading' && <ActivityIndicator testID="analysis-capture-loading" style={StyleSheet.absoluteFill} color={colors.primary} />}
        <Image
          testID="analysis-capture-image"
          accessibilityLabel="Captura de pantalla del sitio analizado"
          source={{ uri, headers: { Authorization: `Bearer ${accessToken}` }, cache: 'reload' }}
          resizeMode="contain"
          style={styles.image}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('hidden')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 16, gap: 11 },
  title: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 14 },
  helper: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 11, lineHeight: 16 },
  frame: { width: '100%', aspectRatio: 9 / 16, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.background, justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
});
