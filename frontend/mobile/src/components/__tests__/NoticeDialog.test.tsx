import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { NoticeDialog } from '../NoticeDialog';
import { colors } from '../../theme/tokens';

describe('NoticeDialog accessible accents', () => {
  it.each([
    ['info', 'i', colors.primaryText],
    ['warning', '!', colors.warning],
  ] as const)('uses readable text contrast for the %s tone', async (tone, mark, expectedColor) => {
    await render(<NoticeDialog visible title="Aviso" message="Mensaje de prueba" tone={tone} onDismiss={jest.fn()} />);

    expect(StyleSheet.flatten(screen.getByText('Entendido').props.style).color).toBe(expectedColor);
    expect(StyleSheet.flatten(screen.getByText(mark).props.style).color).toBe(expectedColor);
  });
});
