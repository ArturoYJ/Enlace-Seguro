import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Skeleton } from '../Skeleton';
import { colors, radius } from '../../theme/tokens';

describe('Skeleton', () => {
  it('has stable dimensions and is decorative for assistive technology', async () => {
    await render(<Skeleton testID="skeleton" width="100%" height={18} radius="md" />);

    const skeleton = screen.getByTestId('skeleton', { includeHiddenElements: true });
    expect(skeleton.props.testID).toBe('skeleton');
    expect(skeleton.props.accessible).toBe(false);
    expect(skeleton.props.accessibilityElementsHidden).toBe(true);
    expect(skeleton.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(StyleSheet.flatten(skeleton.props.style)).toMatchObject({
      width: '100%',
      height: 18,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
    });
  });

  it('accepts custom corner radius and style overrides', async () => {
    await render(<Skeleton testID="skeleton" width={80} height={12} radius={6} style={{ opacity: 0.5 }} />);

    expect(StyleSheet.flatten(screen.getByTestId('skeleton', { includeHiddenElements: true }).props.style)).toMatchObject({
      width: 80,
      height: 12,
      borderRadius: 6,
      opacity: 0.5,
    });
  });
});
