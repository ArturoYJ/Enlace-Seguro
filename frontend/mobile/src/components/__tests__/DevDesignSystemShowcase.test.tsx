import { fireEvent, render, screen } from '@testing-library/react-native';
import { DevDesignSystemShowcase } from '../DevDesignSystemShowcase';

describe('DevDesignSystemShowcase', () => {
  it('renders token samples, closes on request and handles the platform back action', async () => {
    const onClose = jest.fn();
    await render(<DevDesignSystemShowcase visible onClose={onClose} />);

    expect(screen.getByText('Sistema de diseño')).toBeTruthy();
    expect(screen.getByText('primaryAction')).toBeTruthy();
    expect(screen.getByLabelText('Acción primary')).toBeTruthy();
    await fireEvent(screen.getByText('Sistema de diseño'), 'requestClose');
    expect(onClose).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByLabelText('Cerrar showcase del sistema de diseño'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('mounts one alert tone at a time and lets a developer select another tone', async () => {
    await render(<DevDesignSystemShowcase visible onClose={jest.fn()} />);

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('Estado visual: info')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Seleccionar alerta danger'));

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('Estado visual: danger')).toBeTruthy();
    expect(screen.getByLabelText('Seleccionar alerta danger').props.accessibilityState).toEqual({ selected: true });
  });
});
