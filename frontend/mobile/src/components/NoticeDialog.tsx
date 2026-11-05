import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, typefaces } from '../theme/tokens';

type NoticeDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  tone?: 'info' | 'warning';
  onDismiss: () => void;
};

export function NoticeDialog({ visible, title, message, tone = 'info', onDismiss }: NoticeDialogProps) {
  const accent = tone === 'warning' ? colors.warning : colors.primary;
  const accentText = tone === 'warning' ? colors.warning : colors.primaryText;
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View accessibilityRole="alert" accessibilityViewIsModal style={styles.card}>
          <View style={[styles.mark, { borderColor: accent }]}>
          <Text style={[styles.markText, { color: accentText }]}>{tone === 'warning' ? '!' : 'i'}</Text>
          </View>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.action}>
            <Text style={[styles.actionLabel, { color: accentText }]}>Entendido</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: space.xl, backgroundColor: 'rgba(10, 18, 32, 0.78)' },
  card: { width: '100%', maxWidth: 420, alignSelf: 'center', alignItems: 'center', padding: space.xl, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: space.md },
  mark: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: radius.pill, backgroundColor: colors.backgroundDeep },
  markText: { fontFamily: typefaces.bold, fontSize: 21 },
  title: { color: colors.text, fontFamily: typefaces.bold, fontSize: 20, lineHeight: 27, textAlign: 'center' },
  message: { color: colors.textSecondary, fontFamily: typefaces.regular, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  action: { minHeight: 48, minWidth: 120, alignItems: 'center', justifyContent: 'center', marginTop: space.xs },
  actionLabel: { fontFamily: typefaces.semibold, fontSize: 14 },
});
