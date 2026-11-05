import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const axeScript = require.resolve('axe-core');
const appUrl = process.env['ADMIN_E2E_APP_URL'] ?? 'http://127.0.0.1:4173';
const apiUrl = process.env['ADMIN_E2E_API_URL'] ?? 'http://127.0.0.1:3000/api/v1';
const screenshotDir = process.env['ADMIN_E2E_SCREENSHOT_DIR'];
const email = 'admin@enlaceseguro.example.test';
const password = 'e2e-admin-password-not-for-production';
const userEmail = 'user@enlaceseguro.example.test';
const userPassword = 'e2e-user-password-not-for-production';
const browser = await chromium.launch({ headless: true });

async function checkAccessibility(page, state) {
  const results = await page.evaluate(async () => {
    const { violations } = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }
    });
    return violations.map(({ id, impact, help, nodes }) => ({
      id, impact, help, targets: nodes.map(({ target }) => target),
      summaries: nodes.map(({ failureSummary }) => failureSummary)
    }));
  });
  assert.deepEqual(results, [], `${state} accessibility violations: ${JSON.stringify(results)}`);
}

async function assertNoHorizontalOverflow(page, state) {
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  assert.ok(width.content <= width.viewport, `${state} overflows horizontally: ${JSON.stringify(width)}`);
}

async function saveScreenshot(page, state) {
  if (!screenshotDir) return;
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, `${state}.png`), fullPage: true });
}

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(12_000);
  const failedResponses = [];
  const failedRequests = [];
  const nonAdminRequests = [];
  page.on('request', (request) => {
    if (request.url().startsWith(apiUrl)) {
      nonAdminRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  page.on('pageerror', (error) => { failedRequests.push(error.message); });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'unknown failure';
    if (request.url().includes('/api/v1/') && reason !== 'net::ERR_ABORTED') failedRequests.push(`${request.url()}: ${reason}`);
  });
  page.on('response', (response) => {
    if (response.url().startsWith(apiUrl) && response.status() >= 500) {
      failedResponses.push(`${response.request().method()} ${new URL(response.url()).pathname}: ${response.status()}`);
    }
  });

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ path: axeScript });
  await page.getByRole('heading', { name: 'Iniciar sesión' }).waitFor();
  const registration = await page.request.post(`${apiUrl}/auth/register`, {
    data: { email: userEmail, password: userPassword }
  });
  assert.equal(registration.status(), 201, 'normal user fixture should register');
  await page.getByLabel('Correo electrónico').fill(userEmail);
  await page.getByLabel('Contraseña').fill(userPassword);
  await page.getByRole('button', { name: /Entrar a la consola/ }).click();
  await page.getByRole('alert').getByText('Tu cuenta no tiene acceso de administración.').waitFor();
  await page.getByRole('heading', { name: 'Iniciar sesión' }).waitFor();
  assert.ok(nonAdminRequests.some((request) => request.endsWith('GET /api/v1/auth/me')),
    `non-admin login should verify the profile: ${nonAdminRequests.join('; ')}`);
  assert.equal(nonAdminRequests.some((request) => request.includes('/api/v1/admin/')), false,
    `non-admin login must not request admin data: ${nonAdminRequests.join('; ')}`);
  nonAdminRequests.length = 0;
  await checkAccessibility(page, 'login desktop');
  await saveScreenshot(page, 'login-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await checkAccessibility(page, 'login mobile');
  await assertNoHorizontalOverflow(page, 'login mobile');
  await saveScreenshot(page, 'login-mobile');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: /Entrar a la consola/ }).click();

  try {
    await page.getByRole('heading', { name: 'Resumen' }).waitFor();
  } catch (error) {
    const alert = await page.getByRole('alert').allTextContents().catch(() => []);
    console.error(JSON.stringify({ appUrl: page.url(), failedResponses, failedRequests, alert }));
    throw error;
  }
  await page.getByRole('heading', { name: 'Actividad del periodo' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Resumen' }).getAttribute('aria-current'), 'page');
  assert.equal(await page.getByRole('button', { name: 'Auditoría' }).getAttribute('aria-current'), null);
  await page.getByText('Intentos recibidos', { exact: false }).waitFor();
  await checkAccessibility(page, 'summary desktop');
  await saveScreenshot(page, 'summary-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await checkAccessibility(page, 'summary mobile');
  await assertNoHorizontalOverflow(page, 'summary mobile');
  await saveScreenshot(page, 'summary-mobile');
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole('button', { name: 'Auditoría' }).click();
  await page.getByRole('heading', { name: 'Eventos de auditoría' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Auditoría' }).getAttribute('aria-current'), 'page');
  assert.equal(await page.getByRole('button', { name: 'Resumen' }).getAttribute('aria-current'), null);
  await page.getByRole('table', { name: 'REGISTRO DE EVENTOS' }).waitFor();
  await page.locator('tbody tr').filter({ hasText: 'auth.login.succeeded' }).first().waitFor();
  await checkAccessibility(page, 'audit desktop');
  await saveScreenshot(page, 'audit-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await checkAccessibility(page, 'audit mobile');
  await assertNoHorizontalOverflow(page, 'audit mobile');
  await saveScreenshot(page, 'audit-mobile');
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Iniciar sesión' }).waitFor();
  assert.deepEqual(failedResponses, [], `API returned server errors: ${failedResponses.join('; ')}`);
  assert.deepEqual(failedRequests, [], `Browser reported failed requests or page errors: ${failedRequests.join('; ')}`);
  console.log('PASS: browser non-admin denial, admin login/gate, metrics, audit, CORS, memory-only session, axe WCAG A/AA, and mobile overflow checks');
} finally {
  await browser.close();
}
