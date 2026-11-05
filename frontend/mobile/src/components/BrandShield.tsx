import Svg, { Path, Circle } from 'react-native-svg';

type BrandShieldProps = {
  size?: number;
  color?: string;
};

export function BrandShield({ size = 30, color = '#2F7BF5' }: BrandShieldProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 36" fill="none" accessibilityLabel="Escudo EnlaceSeguro">
      <Path
        d="M16 2.5 28 7v9.2c0 8.1-4.9 13.4-12 17.3C8.9 29.6 4 24.3 4 16.2V7l12-4.5Z"
        stroke={color}
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
      <Circle cx="13" cy="17" r="2.1" stroke={color} strokeWidth={1.8} />
      <Circle cx="19" cy="17" r="2.1" stroke={color} strokeWidth={1.8} />
      <Path d="M14.8 17h2.4M12 21.1c2.2 1.2 5.8 1.2 8 0" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}
