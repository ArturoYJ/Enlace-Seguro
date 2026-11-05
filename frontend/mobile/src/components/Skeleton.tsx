import { StyleSheet, View, type DimensionValue, type ViewStyle } from 'react-native';
import { colors, radius as radii } from '../theme/tokens';

type SkeletonRadius = keyof typeof radii | number;

type SkeletonProps = {
  width: DimensionValue;
  height: DimensionValue;
  radius?: SkeletonRadius;
  style?: ViewStyle;
  testID?: string;
};

/** Static placeholder. It has no animation and is hidden from assistive technology. */
export function Skeleton({ width, height, radius = 'sm', style, testID }: SkeletonProps) {
  const borderRadius = typeof radius === 'number' ? radius : radii[radius];
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
      style={[styles.base, { width, height, borderRadius }, style]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surfaceRaised,
  },
});
