// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear(); sessionStorage.clear(); });
describe('admin console', () => {
  it('has no automated structural WCAG A/AA violations on the login screen', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000/api/v1');
    vi.stubGlobal('fetch', vi.fn());
    document.documentElement.lang = 'es';
    document.title = 'Administración | EnlaceSeguro';
    render(<App/>);
    const results = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } }
    });
    expect(results.violations.map(v => `${v.id}: ${v.help}`)).toEqual([]);
  });

  it('gates access, shows real metrics and empty audit, and does not persist session', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000/api/v1');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 900 });
      if (url.endsWith('/auth/me')) return json({ user: { id: '1', role: 'admin', email: 'admin@example.test' } });
      if (url.includes('/admin/metrics')) { const query = new URL(url).searchParams; return json({ dateRange: { startDate: query.get('startDate'), endDate: query.get('endDate') }, totalAttempts: 3, byStatus: { received: 0, validation_failed: 0, processing: 0, completed: 3, inconclusive: 0, failed: 0 }, byVerdict: { peligroso: 1, sospechoso: 1, sin_amenazas_detectadas: 1 } }); }
      return json({ items: [], hasMore: false, nextCursor: null });
    });
    vi.stubGlobal('fetch', fetcher);
    render(<App/>);
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'admin@example.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /Entrar a la consola/ }));
    expect(await screen.findByText('Actividad del periodo')).toBeInTheDocument();
    expect(await screen.findByText('Total registrado en el periodo seleccionado.')).toBeInTheDocument();
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /Auditoría/ }));
    expect(await screen.findByText('No hay eventos para estos filtros.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(await screen.findByText('Iniciar sesión')).toBeInTheDocument();
  });

  it('exposes the current navigation view and names the audit table from its visible caption', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000/api/v1');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 900 });
      if (url.endsWith('/auth/me')) return json({ user: { id: '1', role: 'admin', email: 'admin@example.test' } });
      if (url.includes('/admin/metrics')) { const query = new URL(url).searchParams; return json({ dateRange: { startDate: query.get('startDate'), endDate: query.get('endDate') }, totalAttempts: 0, byStatus: { received: 0, validation_failed: 0, processing: 0, completed: 0, inconclusive: 0, failed: 0 }, byVerdict: { peligroso: 0, sospechoso: 0, sin_amenazas_detectadas: 0 } }); }
      return json({ items: [{ id: 'event-1', occurredAt: '2026-11-04T18:00:00.000Z', eventType: 'auth.login.succeeded', outcome: 'success' }], hasMore: false, nextCursor: null });
    });
    vi.stubGlobal('fetch', fetcher);
    render(<App/>);
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'admin@example.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /Entrar a la consola/ }));
    expect(await screen.findByText('Actividad del periodo')).toBeInTheDocument();

    const summaryButton = screen.getByRole('button', { name: /Resumen/ });
    const auditButton = screen.getByRole('button', { name: /Auditoría/ });
    expect(summaryButton).toHaveAttribute('aria-current', 'page');
    expect(auditButton).not.toHaveAttribute('aria-current');

    fireEvent.click(auditButton);
    expect(await screen.findByText('auth.login.succeeded')).toBeInTheDocument();
    expect(auditButton).toHaveAttribute('aria-current', 'page');
    expect(summaryButton).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('table', { name: 'REGISTRO DE EVENTOS' })).toBeInTheDocument();
  });
});
