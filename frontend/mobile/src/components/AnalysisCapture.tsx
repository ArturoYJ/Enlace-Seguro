import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiUrl } from '../lib/session';
import { colors, radius, typefaces } from '../theme/tokens';

type Props = { attemptId: string; accessToken: string };
type Status = 'loading' | 'ready' | 'hidden';

// El padre la monta con key={attemptId}, así el estado se reinicia por análisis.
// La API responde 404 cuando no hay captura o el proxy está apagado; en ese caso la sección no se muestra.
export function AnalysisCapture({ attemptId, accessToken }: Props) {
  const [status, setStatus] = useState<Status>('loading');
  // El sandbox navega con un viewport de escritorio; la proporción real llega en onLoad.
  const [aspectRatio, setAspectRatio] = useState(16 / 10);
  const [expanded, setExpanded] = useState(false);

  let uri: string;
  try { uri = apiUrl(`/analyses/${encodeURIComponent(attemptId)}/capture`); } catch { return null; }
  if (status === 'hidden') return null;
  const source = { uri, headers: { Authorization: `Bearer ${accessToken}` }, cache: 'reload' as const };

  return (
    <View style={styles.section} testID="analysis-capture">
      <View style={styles.headerRow}>
        <Text style={styles.title}>Así se veía la página</Text>
        <View style={styles.badge}><Text style={styles.badgeText}>ENTORNO AISLADO</Text></View>
      </View>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel="Captura de pantalla del sitio analizado. Toca para ampliar."
        disabled={status !== 'ready'}
        onPress={() => setExpanded(true)}
        style={[styles.frame, { aspectRatio }]}
      >
        {status === 'loading' && <ActivityIndicator testID="analysis-capture-loading" style={StyleSheet.absoluteFill} color={colors.primary} />}
        <Image
          testID="analysis-capture-image"
          source={source}
          resizeMode="contain"
          style={styles.image}
          onLoad={(event) => {
            const size = event?.nativeEvent?.source;
            if (size?.width && size?.height) setAspectRatio(size.width / size.height);
            setStatus('ready');
          }}
          onError={() => setStatus('hidden')}
        />
      </Pressable>
      <Text style={styles.helper}>{status === 'ready' ? 'Toca la imagen para ampliarla. ' : ''}No abras el enlace para comprobarlo.</Text>
      <Modal visible={expanded} animationType="fade" onRequestClose={() => setExpanded(false)} supportedOrientations={['portrait', 'landscape']}>
        <SafeAreaView style={styles.modal}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cerrar captura" onPress={() => setExpanded(false)} style={styles.close}>
            <Text style={styles.closeText}>Cerrar</Text>
          </Pressable>
          <Image testID="analysis-capture-expanded" source={source} resizeMode="contain" style={styles.expandedImage} />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 16, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 17 },
  badge: { borderRadius: radius.pill, backgroundColor: `${colors.primary}22`, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: colors.primaryText, fontFamily: typefaces.semibold, fontSize: 12, letterSpacing: 0.8 },
  frame: { width: '100%', borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.backgroundDeep, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  helper: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 13, lineHeight: 19 },
  modal: { flex: 1, backgroundColor: '#000' },
  close: { alignSelf: 'flex-end', paddingHorizontal: 18, paddingVertical: 12 },
  closeText: { color: colors.white, fontFamily: typefaces.semibold, fontSize: 17 },
  expandedImage: { flex: 1, width: '100%' },
});
