import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeUrl, registrableDomain } from '../src/core/UrlHeuristics.js';
import { VerdictEvaluator } from '../src/core/VerdictEvaluator.js';

describe('UrlHeuristics', () => {
  it('obtiene el dominio registrable con sufijos de dos niveles', () => {
    assert.equal(registrableDomain('www.bbva.mx'), 'bbva.mx');
    assert.equal(registrableDomain('portal.sat.gob.mx'), 'sat.gob.mx');
    assert.equal(registrableDomain('login.banorte.com.mx'), 'banorte.com.mx');
    assert.equal(registrableDomain('127.0.0.1'), '127.0.0.1');
  });

  it('marca una marca conocida dentro de un dominio que no es el suyo', () => {
    const r = analyzeUrl('https://bbva-mx-verificacion.com/acceso');
    assert.ok(r.signals.includes('brand_impersonation'));
    assert.deepEqual(r.reasons, ['El nombre "bbva" aparece en el enlace, pero el dominio real es "bbva-mx-verificacion.com".']);
  });

  it('no marca el dominio oficial de la marca ni sus subdominios', () => {
    for (const url of ['https://www.bbva.mx/', 'https://sat.gob.mx/', 'https://accounts.google.com/', 'https://www.mercadolibre.com.mx/']) {
      assert.deepEqual(analyzeUrl(url).signals, [], url);
    }
  });

  it('compara marcas como palabra completa y no como fragmento', () => {
    assert.deepEqual(analyzeUrl('https://pineapple-recetas.com/').signals, []);
    assert.deepEqual(analyzeUrl('https://satelites.org/').signals, []);
  });

  it('marca extensiones de abuso, IP directa y punycode', () => {
    assert.ok(analyzeUrl('https://entrega-paquete.top/').signals.includes('suspicious_tld'));
    assert.deepEqual(analyzeUrl('http://1.1.1.1/login').signals, ['ip_literal_host']);
  });

  it('no marca IPs privadas ni de loopback (el filtro anti-SSRF ya las bloquea)', () => {
    for (const url of ['http://127.0.0.1:8080/', 'http://192.168.1.10/', 'http://10.0.0.5/', 'http://[::1]:3000/']) {
      assert.deepEqual(analyzeUrl(url).signals, [], url);
    }
    assert.ok(analyzeUrl('https://xn--pypal-4ve.com/').signals.includes('punycode_domain'));
  });

  it('ignora URLs mal formadas sin lanzar error', () => {
    assert.deepEqual(analyzeUrl('no es una url'), { signals: [], reasons: [] });
  });
});

describe('VerdictEvaluator con señales de URL', () => {
  it('login sobre HTTPS en dominio que suplanta una marca es peligroso', () => {
    const result = VerdictEvaluator.evaluate({
      targetUrl: 'https://banorte-seguridad.click/login',
      finalDestination: 'https://banorte-seguridad.click/login',
      redirects: [],
      signals: ['password_input_present']
    });
    assert.equal(result.verdict, 'peligroso');
    assert.ok(result.signals.includes('credential_harvesting_detected'));
    assert.ok(result.signals.includes('brand_impersonation'));
    assert.ok(result.signals.includes('suspicious_tld'));
  });

  it('login sobre HTTPS en un dominio sin señales sigue sin amenazas', () => {
    const result = VerdictEvaluator.evaluate({
      targetUrl: 'https://accounts.google.com/signin',
      finalDestination: 'https://accounts.google.com/signin',
      redirects: [],
      signals: ['password_input_present']
    });
    assert.equal(result.verdict, 'sin_amenazas_detectadas');
  });

  it('una señal de URL sin formulario de contraseña es sospechosa', () => {
    const result = VerdictEvaluator.evaluate({
      targetUrl: 'https://paypal-reembolso.com/',
      finalDestination: 'https://paypal-reembolso.com/',
      redirects: [],
      signals: []
    });
    assert.equal(result.verdict, 'sospechoso');
    assert.ok(result.reasons.includes('El nombre "paypal" aparece en el enlace, pero el dominio real es "paypal-reembolso.com".'));
  });

  it('revisa también el destino final después de redirecciones', () => {
    const result = VerdictEvaluator.evaluate({
      targetUrl: 'https://acortador.example/abc',
      finalDestination: 'https://xn--pypal-4ve.com/pago',
      redirects: ['https://acortador.example/abc'],
      signals: []
    });
    assert.equal(result.verdict, 'sospechoso');
    assert.ok(result.signals.includes('punycode_domain'));
  });
});
