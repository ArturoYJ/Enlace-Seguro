import { StyleSheet, Text, View } from 'react-native';
import { BrandShield } from './BrandShield';
import { colors, typefaces } from '../theme/tokens';

export function BrandWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.row}>
      <BrandShield size={compact ? 23 : 29} />
      <Text style={[styles.wordmark, compact && styles.compact]}>Enlace<Text style={styles.accent}>Seguro</Text></Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  wordmark: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 16, letterSpacing: -0.2 },
  compact: { fontSize: 14 },
  accent: { color: colors.primaryText },
});
