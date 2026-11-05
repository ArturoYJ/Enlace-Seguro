import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, typefaces } from '../theme/tokens';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

type AlertProps = {
  tone: AlertTone;
  message: string;
  title?: string;
};

const toneColors: Record<AlertTone, string> = {
  info: colors.primary,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
};

/** Inline, announced feedback. Use only for a state change that needs attention. */
export function Alert({ tone, title, message }: AlertProps) {
  const accent = toneColors[tone];
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion={tone === 'danger' ? 'assertive' : 'polite'}
      style={[styles.container, { borderLeftColor: accent }]}
    >
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: space.xs,
    padding: space.md,
  },
  title: {
    color: colors.text,
    fontFamily: typefaces.semibold,
    fontSize: 14,
    lineHeight: 20,
  },
  message: {
    color: colors.textSecondary,
    fontFamily: typefaces.regular,
    fontSize: 14,
    lineHeight: 21,
  },
});
