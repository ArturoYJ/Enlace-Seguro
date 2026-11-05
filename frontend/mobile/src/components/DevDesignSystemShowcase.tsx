import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Alert, type AlertTone } from './Alert';
import { PrimaryButton, type ButtonVariant } from './PrimaryButton';
import { Skeleton } from './Skeleton';
import { colors, radius, space, typefaces } from '../theme/tokens';

type DevDesignSystemShowcaseProps = {
  visible: boolean;
  onClose: () => void;
};

const buttonVariants: ButtonVariant[] = ['primary', 'secondary', 'inverted', 'outlined'];
const alertTones: AlertTone[] = ['info', 'success', 'warning', 'danger'];
const spacingSamples = Object.entries(space) as [keyof typeof space, number][];
const radiusSamples = Object.entries(radius) as [keyof typeof radius, number][];
const colorSamples = Object.entries(colors) as [keyof typeof colors, string][];
const typefaceSamples = Object.entries(typefaces) as [keyof typeof typefaces, string][];

/** Development-only visual catalog; deliberately not registered as an application route. */
export function DevDesignSystemShowcase({ visible, onClose }: DevDesignSystemShowcaseProps) {
  const [selectedTone, setSelectedTone] = useState<AlertTone>('info');

  if (!__DEV__ || !visible) return null;

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      presentationStyle="fullScreen"
    >
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>SOLO DESARROLLO</Text>
            <Text accessibilityRole="header" style={styles.title}>Sistema de diseño</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cerrar showcase del sistema de diseño"
            accessibilityHint="Cierra la muestra y vuelve a la pantalla anterior"
            onPress={onClose}
            hitSlop={12}
            style={styles.closeButton}
          >
            <Text style={styles.closeLabel}>Cerrar</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <SectionTitle>Paleta</SectionTitle>
          <View style={styles.swatches}>
            {colorSamples.map(([name, value]) => (
              <View key={name} style={styles.swatchCard}>
                <View
                  accessible
                  accessibilityLabel={`${name}, ${value}`}
                  style={[styles.swatch, { backgroundColor: value }]}
                />
                <Text style={styles.sampleName}>{name}</Text>
                <Text style={styles.sampleValue}>{value}</Text>
              </View>
            ))}
          </View>

          <SectionTitle>IBM Plex Sans</SectionTitle>
          <View style={styles.sampleCard}>
            {typefaceSamples.map(([weight, family]) => (
              <View key={weight} style={styles.typefaceRow}>
                <Text style={styles.typefaceLabel}>{weight}</Text>
                <Text style={{ color: colors.text, fontFamily: family, fontSize: 18 }}>
                  EnlaceSeguro 0123
                </Text>
              </View>
            ))}
          </View>

          <SectionTitle>Espaciado</SectionTitle>
          <View style={styles.sampleCard}>
            {spacingSamples.map(([name, value]) => (
              <View key={name} style={styles.scaleRow}>
                <Text style={styles.sampleName}>{name}</Text>
                <View style={[styles.spacingSample, { width: value }]} />
                <Text style={styles.sampleValue}>{value} px</Text>
              </View>
            ))}
          </View>

          <SectionTitle>Radios</SectionTitle>
          <View style={styles.radiusSamples}>
            {radiusSamples.map(([name, value]) => (
              <View key={name} style={styles.radiusCard}>
                <View style={[styles.radiusSample, { borderRadius: value }]} />
                <Text style={styles.sampleName}>{name}</Text>
                <Text style={styles.sampleValue}>{value} px</Text>
              </View>
            ))}
          </View>

          <SectionTitle>Botones</SectionTitle>
          <View style={styles.buttonSamples}>
            {buttonVariants.map((variant) => (
              <PrimaryButton
                key={variant}
                variant={variant}
                label={`Acción ${variant}`}
                onPress={() => undefined}
              />
            ))}
          </View>

          <SectionTitle>Alertas</SectionTitle>
          <View style={styles.toneSelectors}>
            {alertTones.map((tone) => (
              <Pressable
                key={tone}
                accessibilityRole="button"
                accessibilityLabel={`Seleccionar alerta ${tone}`}
                accessibilityState={{ selected: selectedTone === tone }}
                onPress={() => setSelectedTone(tone)}
                style={[styles.toneButton, selectedTone === tone && styles.toneButtonSelected]}
              >
                <Text style={[styles.toneLabel, selectedTone === tone && styles.toneLabelSelected]}>{tone}</Text>
              </Pressable>
            ))}
          </View>
          <Alert tone={selectedTone} title="Aviso de muestra" message={`Estado visual: ${selectedTone}`} />

          <SectionTitle>Placeholder</SectionTitle>
          <View style={styles.sampleCard}>
            <View style={styles.skeletonLine}>
              <Skeleton width={38} height={38} radius="md" />
              <View style={styles.skeletonCopy}>
                <Skeleton width="82%" height={14} />
                <Skeleton width="55%" height={11} />
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <Text accessibilityRole="header" style={styles.sectionTitle}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingHorizontal: space.xl, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerCopy: { gap: space.xs },
  eyebrow: { color: colors.primaryText, fontFamily: typefaces.semibold, fontSize: 10, letterSpacing: 1.2 },
  title: { color: colors.text, fontFamily: typefaces.bold, fontSize: 21 },
  closeButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
  closeLabel: { color: colors.primaryText, fontFamily: typefaces.semibold, fontSize: 14 },
  content: { gap: space.md, paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxxl },
  sectionTitle: { color: colors.text, fontFamily: typefaces.semibold, fontSize: 16, marginTop: space.md },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatchCard: { width: '30%', flexGrow: 1, gap: space.xs, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  swatch: { height: 34, borderRadius: radius.sm },
  sampleName: { color: colors.text, fontFamily: typefaces.medium, fontSize: 12 },
  sampleValue: { color: colors.textMuted, fontFamily: typefaces.regular, fontSize: 10 },
  sampleCard: { gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  typefaceRow: { minHeight: 32, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  typefaceLabel: { color: colors.textSecondary, fontFamily: typefaces.medium, fontSize: 11 },
  scaleRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: space.md },
  spacingSample: { height: 6, maxWidth: '55%', borderRadius: radius.pill, backgroundColor: colors.primary },
  radiusSamples: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  radiusCard: { minWidth: 80, flexGrow: 1, alignItems: 'center', gap: space.xs, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  radiusSample: { width: 54, height: 32, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.primaryText },
  buttonSamples: { gap: space.sm },
  toneSelectors: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  toneButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  toneButtonSelected: { borderColor: colors.primaryText, backgroundColor: colors.surfaceRaised },
  toneLabel: { color: colors.textSecondary, fontFamily: typefaces.medium, fontSize: 12, textTransform: 'capitalize' },
  toneLabelSelected: { color: colors.text, fontFamily: typefaces.semibold },
  skeletonLine: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  skeletonCopy: { flex: 1, gap: space.sm },
});
