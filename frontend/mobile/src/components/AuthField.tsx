import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors, radius, typefaces } from '../theme/tokens';

type AuthFieldProps = TextInputProps & { label: string; secret?: boolean; leadingIcon?: 'mail' | 'lock' };

function FieldIcon({ name }: { name: 'mail' | 'lock' }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      {name === 'mail' ? (
        <>
          <Rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke={colors.textMuted} strokeWidth="1.7" />
          <Path d="m4.5 7 7.5 5.5L19.5 7" stroke={colors.textMuted} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <Rect x="5" y="10" width="14" height="11" rx="2" stroke={colors.textMuted} strokeWidth="1.7" />
          <Path d="M8 10V7a4 4 0 0 1 8 0v3" stroke={colors.textMuted} strokeWidth="1.7" strokeLinecap="round" />
          <Circle cx="12" cy="15" r="1" fill={colors.textMuted} />
        </>
      )}
    </Svg>
  );
}

function VisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M2.5 12s3.2-6 9.5-6 9.5 6 9.5 6-3.2 6-9.5 6-9.5-6-9.5-6Z" stroke={colors.textMuted} strokeWidth="1.7" strokeLinejoin="round" />
      <Circle cx="12" cy="12" r="2.5" stroke={colors.textMuted} strokeWidth="1.7" />
      {visible && <Path d="m4 20 16-16" stroke={colors.textMuted} strokeWidth="1.7" strokeLinecap="round" />}
    </Svg>
  );
}

export function AuthField({ label, secret = false, leadingIcon, ...props }: AuthFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        {leadingIcon && <FieldIcon name={leadingIcon} />}
        <TextInput
          {...props}
          accessibilityLabel={label}
          autoCapitalize={props.autoCapitalize ?? 'none'}
          autoCorrect={false}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secret && !visible}
          style={styles.input}
        />
        {secret && (
          <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} onPress={() => setVisible(!visible)} hitSlop={12}>
            <VisibilityIcon visible={visible} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { color: colors.textSecondary, fontFamily: typefaces.medium, fontSize: 13 },
  inputWrap: { minHeight: 54, flexDirection: 'row', alignItems: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceInput, paddingHorizontal: 14, gap: 10 },
  input: { flex: 1, color: colors.text, fontFamily: typefaces.regular, fontSize: 15, paddingVertical: 14 },
});
