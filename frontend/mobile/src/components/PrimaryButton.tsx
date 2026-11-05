import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, typefaces } from '../theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'inverted' | 'outlined';

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
};

export function PrimaryButton({ label, onPress, accessibilityLabel, variant = 'primary', disabled = false, loading = false }: PrimaryButtonProps) {
  const appearance = variants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, appearance.button, pressed && !disabled && appearance.pressed, (disabled || loading) && styles.disabled]}>
      {loading ? <ActivityIndicator color={appearance.indicator} /> : <Text style={[styles.label, appearance.label]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 54,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderWidth: 1,
  },
  primary: { backgroundColor: colors.primaryAction, borderColor: colors.primaryAction },
  primaryPressed: { backgroundColor: colors.primaryPressed, borderColor: colors.primaryPressed, transform: [{ scale: 0.99 }] },
  secondary: { backgroundColor: colors.surfaceRaised, borderColor: colors.surfaceRaised },
  secondaryPressed: { backgroundColor: colors.surface, borderColor: colors.border, transform: [{ scale: 0.99 }] },
  inverted: { backgroundColor: colors.white, borderColor: colors.white },
  invertedPressed: { backgroundColor: colors.textSecondary, borderColor: colors.textSecondary, transform: [{ scale: 0.99 }] },
  outlined: { backgroundColor: 'transparent', borderColor: colors.textSecondary },
  outlinedPressed: { backgroundColor: colors.surfaceRaised, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.55 },
  label: { fontSize: 15, fontFamily: typefaces.semibold, letterSpacing: 0.2 },
  primaryLabel: { color: colors.white },
  secondaryLabel: { color: colors.text },
  invertedLabel: { color: colors.backgroundDeep },
  outlinedLabel: { color: colors.text },
});

const variants = {
  primary: { button: styles.primary, pressed: styles.primaryPressed, label: styles.primaryLabel, indicator: colors.white },
  secondary: { button: styles.secondary, pressed: styles.secondaryPressed, label: styles.secondaryLabel, indicator: colors.text },
  inverted: { button: styles.inverted, pressed: styles.invertedPressed, label: styles.invertedLabel, indicator: colors.backgroundDeep },
  outlined: { button: styles.outlined, pressed: styles.outlinedPressed, label: styles.outlinedLabel, indicator: colors.text },
} satisfies Record<ButtonVariant, { button: object; pressed: object; label: object; indicator: string }>;
