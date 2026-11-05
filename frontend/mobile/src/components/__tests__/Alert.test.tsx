import { render, screen } from '@testing-library/react-native';
import { Alert } from '../Alert';

describe('Alert accessibility', () => {
  it.each([
    ['info', 'polite'],
    ['success', 'polite'],
    ['warning', 'polite'],
    ['danger', 'assertive'],
  ] as const)('announces a %s message with %s priority', async (tone, priority) => {
    await render(<Alert tone={tone} title="Estado" message="No se pudo completar la acción." />);

    const alert = screen.getByRole('alert');
    expect(alert.props.accessibilityLiveRegion).toBe(priority);
    expect(screen.getByText('Estado')).toBeTruthy();
    expect(screen.getByText('No se pudo completar la acción.')).toBeTruthy();
  });

  it('supports a message-only alert', async () => {
    await render(<Alert tone="info" message="No hay análisis recientes." />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('No hay análisis recientes.')).toBeTruthy();
  });
});
