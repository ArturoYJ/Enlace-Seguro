export const colors = {
  // Verified anchors: Primary, Secondary, Tertiary and Neutral. Remaining shades are first-pass visual
  // approximations, not measured Figma tokens; replace them after the full token/ramp inspector pass.
  background: '#0B1321',
  backgroundDeep: '#0A1220',
  surface: '#16233A',
  surfaceRaised: '#1F2D45',
  surfaceInput: '#111D31',
  primary: '#2F7BF5',
  primaryPressed: '#2467D4',
  // Accessibility-derived CTA shade: keeps the Figma primary anchor for brand/icon use,
  // while preserving >= 4.5:1 with the white button label.
  primaryAction: '#2A6FD8',
  primaryText: '#8BB6FF',
  text: '#F4F7FC',
  textSecondary: '#94A2B8',
  // Small secondary copy must still meet WCAG AA on every dark surface.
  textMuted: '#94A2B8',
  border: '#263753',
  success: '#45D6A0',
  warning: '#F4B544',
  danger: '#F46D82',
  white: '#FFFFFF',
} as const;

export const typefaces = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  bold: 'IBMPlexSans_700Bold',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  pill: 999,
} as const;
