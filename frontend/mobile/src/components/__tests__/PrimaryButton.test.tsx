import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PrimaryButton, type ButtonVariant } from '../PrimaryButton';
import { colors } from '../../theme/tokens';

describe('PrimaryButton variants', () => {
  it.each([
    ['primary', colors.primaryAction, colors.primaryAction, colors.white],
    ['secondary', colors.surfaceRaised, colors.surfaceRaised, colors.text],
    ['inverted', colors.white, colors.white, colors.backgroundDeep],
    ['outlined', 'transparent', colors.textSecondary, colors.text],
  ] as const)('renders the %s Figma variant using existing theme colors', async (variant, backgroundColor, borderColor, labelColor) => {
    await render(<PrimaryButton label="Continuar" variant={variant as ButtonVariant} onPress={() => undefined} />);

    const button = screen.getByRole('button', { name: 'Continuar' });
    const label = screen.getByText('Continuar');
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({ backgroundColor, borderColor });
    expect(StyleSheet.flatten(label.props.style)).toMatchObject({ color: labelColor });
  });

  it('preserves busy/disabled semantics and suppresses presses while loading', async () => {
    const onPress = jest.fn();
    await render(<PrimaryButton label="Guardar" variant="outlined" loading onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Guardar' });
    expect(button.props.accessibilityState).toEqual({ disabled: true, busy: true });
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
