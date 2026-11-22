import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProbe, carriesCanary, classifyFollowUpField, createCanary } from '../src/core/CredentialProbe.js';
import { VerdictEvaluator } from '../src/core/VerdictEvaluator.js';

describe('CredentialProbe', () => {
  it('crea credenciales inventadas, únicas y en un dominio que no recibe correo', () => {
    const a = createCanary();
    const b = createCanary();
    assert.match(a.identity, /^es[0-9a-f]{10}@enlaceseguro\.invalid$/);
    assert.notEqual(a.identity, b.identity);
    assert.notEqual(a.password, b.password);
  });

  it('encuentra la credencial en la URL, en un formulario codificado o en JSON', () => {
    const canary = createCanary();
    assert.ok(carriesCanary(canary, `https://x.example/c?u=${encodeURIComponent(canary.identity)}`));
    assert.ok(carriesCanary(canary, 'https://x.example/c', `user=${encodeURIComponent(canary.identity)}&pass=x`));
    assert.ok(carriesCanary(canary, 'https://x.example/c', JSON.stringify({ p: canary.password })));
    assert.ok(!carriesCanary(canary, 'https://x.example/c', 'user=otro&pass=otro'));
  });

  it('no reporta nada si no se pudo enviar el formulario', () => {
    assert.deepEqual(analyzeProbe({ pageUrl: 'https://a.example/', submitted: false, exfiltrationUrls: [], followUpKinds: [] }).signals, []);
  });

  it('distingue el envío al mismo sitio del envío a otro dominio', () => {
    const same = analyzeProbe({ pageUrl: 'https://login.banco.example/', submitted: true, exfiltrationUrls: ['https://api.banco.example/auth'], followUpKinds: [] });
    assert.ok(same.signals.includes('credentials_sent_to_same_site'));
    assert.ok(!same.signals.includes('credential_exfiltration_detected'));

    const other = analyzeProbe({ pageUrl: 'https://login.banco.example/', submitted: true, exfiltrationUrls: ['https://colector.example/c'], followUpKinds: [] });
    assert.ok(other.signals.includes('credential_exfiltration_detected'));
    assert.deepEqual(other.exfiltrationSites, ['colector.example']);
  });

  it('detecta cuando después pide tarjeta o código y cuando lleva a otro sitio', () => {
    const result = analyzeProbe({
      pageUrl: 'https://falso.example/login', submitted: true, exfiltrationUrls: [],
      followUpKinds: ['card', 'otp'], urlAfterSubmit: 'https://banco-real.example/'
    });
    assert.ok(result.signals.includes('requests_card_data_after_login'));
    assert.ok(result.signals.includes('requests_security_code_after_login'));
    assert.ok(result.signals.includes('post_login_redirect_to_other_site'));
  });

  it('clasifica campos por sus atributos sin confundir el código postal', () => {
    assert.equal(classifyFollowUpField('cardnumber  Número de tarjeta cc-number text'), 'card');
    assert.equal(classifyFollowUpField('cvv  CVV cc-csc text'), 'cvv');
    assert.equal(classifyFollowUpField('codigo  Código SMS one-time-code text'), 'otp');
    assert.equal(classifyFollowUpField('nip  NIP  password', 4), 'pin');
    assert.equal(classifyFollowUpField('cp  Código postal  text'), null);
    assert.equal(classifyFollowUpField('email  Correo  email'), null);
  });
});

describe('VerdictEvaluator con la prueba de credenciales', () => {
  const base = { targetUrl: 'https://login.example/', finalDestination: 'https://login.example/', redirects: [] };

  it('aceptar credenciales inventadas y pedir tarjeta es peligroso', () => {
    const r = VerdictEvaluator.evaluate({ ...base, signals: ['password_input_present', 'credential_probe_submitted', 'requests_card_data_after_login'] });
    assert.equal(r.verdict, 'peligroso');
    assert.ok(r.reasons.some((x) => x.includes('tarjeta')));
  });

  it('mandar el login a otro dominio sin más señales es solo sospechoso (SSO legítimo)', () => {
    const r = VerdictEvaluator.evaluate({ ...base, signals: ['password_input_present', 'credential_probe_submitted', 'credential_exfiltration_detected'] });
    assert.equal(r.verdict, 'sospechoso');
  });

  it('mandar los datos a otro dominio y luego llevar a otro sitio es peligroso', () => {
    const r = VerdictEvaluator.evaluate({
      ...base,
      signals: ['password_input_present', 'credential_probe_submitted', 'credential_exfiltration_detected', 'post_login_redirect_to_other_site']
    });
    assert.equal(r.verdict, 'peligroso');
  });

  it('un login legítimo que rechaza las credenciales sigue sin amenazas', () => {
    const r = VerdictEvaluator.evaluate({ ...base, signals: ['password_input_present', 'credential_probe_submitted', 'credentials_sent_to_same_site'] });
    assert.equal(r.verdict, 'sin_amenazas_detectadas');
  });
});
