import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// This test uses the already-provisioned local demo account; it never logs credentials or tokens.
const require = createRequire(new URL('../../frontend/admin-console/package.json', import.meta.url));
const { chromium } = require('playwright');
const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;
if (!email || !password) throw new Error('Load api/.env.admin.local before running this test.');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', () => errors.push('page error'));
  page.on('response', response => {
    if (new URL(response.url()).pathname.startsWith('/api/v1/') && response.status() >= 500) errors.push('API server error');
  });
  const login = async () => {
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña').fill(password);
    await page.getByRole('button', { name: /Entrar a la consola/ }).click();
    await page.getByRole('heading', { name: 'Actividad del periodo' }).waitFor();
  };
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await login();
  await page.getByText('Intentos recibidos', { exact: false }).waitFor();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await page.getByLabel('Desde').fill(today);
  await page.getByLabel('Hasta').fill(today);
  const metricsResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/admin/metrics') && url.searchParams.get('startDate') === today && url.searchParams.get('endDate') === today;
  });
  await page.getByRole('button', { name: 'Aplicar' }).click();
  assert.equal((await metricsResponse).status(), 200);
  await page.getByRole('button', { name: 'Auditoría' }).click();
  await page.getByRole('heading', { name: 'Eventos de auditoría' }).waitFor();
  await page.getByRole('table', { name: 'REGISTRO DE EVENTOS' }).waitFor();
  const auditResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/admin/audit-events') && url.searchParams.get('eventType') === 'auth.login.succeeded' && url.searchParams.get('startDate') === today && url.searchParams.get('endDate') === today;
  });
  await page.getByLabel('Tipo de evento').selectOption('auth.login.succeeded');
  assert.equal((await auditResponse).status(), 200);
  await page.locator('tbody tr').filter({ hasText: 'auth.login.succeeded' }).first().waitFor();
  for (const row of await page.locator('tbody tr').all()) assert.match(await row.innerText(), /auth\.login\.succeeded/);
  // Exercise pagination controls deterministically with intercepted synthetic
  // pages; the real API/Mongo cursor contract is covered by integration tests.
  const requestedCursors = [];
  const auditRoute = '**/api/v1/admin/audit-events?*';
  await page.route(auditRoute, async route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    requestedCursors.push(cursor);
    const second = cursor === 'synthetic-next';
    await route.fulfill({ status: 200, contentType: 'application/json', json: {
      items: [{ id: second ? 'fixture-2' : 'fixture-1', occurredAt: new Date().toISOString(), eventType: 'auth.login.succeeded', actorType: second ? 'Página sintética 2' : 'Página sintética 1' }],
      hasMore: !second, nextCursor: second ? null : 'synthetic-next'
    }});
  });
  await page.getByLabel('Tipo de evento').selectOption('');
  await page.getByText('Página sintética 1', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Siguiente/ }).click();
  await page.getByText('Página sintética 2', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Siguiente/ }).isDisabled(), true);
  await page.getByRole('button', { name: /Anterior/ }).click();
  await page.getByText('Página sintética 1', { exact: true }).waitFor();
  assert.deepEqual(requestedCursors, [null, 'synthetic-next', null]);
  await page.unroute(auditRoute);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Iniciar sesión' }).waitFor();
  await login();
  await page.getByRole('button', { name: 'Salir' }).click();
  await page.getByRole('heading', { name: 'Iniciar sesión' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: local admin UI login, date/event filters, metrics, audit, synthetic pagination, reload and logout');
} finally {
  await browser.close();
}
