import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { colors } from '../theme/tokens';

type OnboardingIllustrationProps = { step: number };

export function OnboardingIllustration({ step }: OnboardingIllustrationProps) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 320 270" fill="none" accessibilityLabel={`Ilustración de seguridad, paso ${step + 1}`}>
      <Circle cx="160" cy="135" r="112" stroke="#1B2B45" strokeDasharray="2 9" />
      <Circle cx="160" cy="135" r="88" stroke="#182943" />
      <G>
        <Rect x="75" y="35" width="170" height="200" rx="28" fill="#101C30" stroke="#253956" />
        <Rect x="95" y="56" width="130" height="34" rx="10" fill="#17263D" />
        <Circle cx="112" cy="73" r="6" fill="#2F7BF5" opacity="0.8" />
        <Rect x="126" y="68" width="77" height="5" rx="2.5" fill="#70819B" />
        <Rect x="126" y="77" width="54" height="4" rx="2" fill="#435674" />
        <Rect x="95" y="101" width="130" height="76" rx="14" fill="#16233A" />
        <Rect x="108" y="116" width="84" height="5" rx="2.5" fill="#8292AA" />
        <Rect x="108" y="128" width="102" height="5" rx="2.5" fill="#536783" />
        <Rect x="108" y="140" width="69" height="5" rx="2.5" fill="#536783" />
        <Rect x="108" y="154" width="91" height="10" rx="5" fill={step === 0 ? '#633344' : '#1F3658'} />
        <Path d="M116 159h18" stroke={step === 0 ? colors.danger : colors.primary} strokeWidth="3" strokeLinecap="round" />
        <Rect x="95" y="188" width="130" height="29" rx="10" fill="#111D31" />
        <Rect x="108" y="199" width="49" height="5" rx="2.5" fill="#536783" />
      </G>
      {step === 0 && (
        <G>
          <Circle cx="230" cy="118" r="24" fill="#332B29" stroke={colors.warning} />
          <Path d="M230 105v14" stroke={colors.warning} strokeWidth="3" strokeLinecap="round" />
          <Circle cx="230" cy="125" r="1.8" fill={colors.warning} />
        </G>
      )}
      {step === 1 && (
        <G>
          <Circle cx="241" cy="182" r="23" fill="#142D4B" stroke={colors.primary} />
          <Path d="m241 169 9 3.4v7c0 5.3-3.8 9.2-9 12-5.2-2.8-9-6.7-9-12v-7l9-3.4Z" stroke="#79A9FF" strokeWidth="1.8" />
          <Path d="m237 181 3 3 5-6" stroke="#79A9FF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </G>
      )}
      {step === 2 && (
        <G>
          <Circle cx="239" cy="86" r="24" fill="#142D4B" stroke={colors.primary} />
          <Path d="m239 72 10 4v7c0 5.9-4.2 10.1-10 13-5.8-2.9-10-7.1-10-13v-7l10-4Z" stroke="#79A9FF" strokeWidth="1.8" />
          <Circle cx="112" cy="225" r="7" fill="#1E463E" />
          <Circle cx="160" cy="225" r="7" fill="#453A25" />
          <Circle cx="208" cy="225" r="7" fill="#4B2838" />
        </G>
      )}
    </Svg>
  );
}
