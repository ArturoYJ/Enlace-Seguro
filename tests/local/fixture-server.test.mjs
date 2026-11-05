import assert from 'node:assert/strict';
import { test } from 'node:test';
import { get as httpsGet } from 'node:https';
import { startFixtures } from './fixture-server.mjs';

test('loopback fixtures serve clean/suspicious pages, timeout and untrusted TLS', async () => {
  const fixture = await startFixtures();
  try {
    const clean = await fetch(`${fixture.httpUrl}/clean`);
    assert.equal(clean.status, 200);
    assert.match(await clean.text(), /Página de prueba/);
    const suspicious = await fetch(`${fixture.httpUrl}/suspicious`);
    assert.match(await suspicious.text(), /type="password"/);
    assert.match(await (await fetch(`${fixture.httpUrl}/suspicious`)).text(), /display:none/);
    assert.equal((await fetch(`${fixture.httpUrl}/unknown`)).status, 404);
    await assert.rejects(fetch(`${fixture.httpUrl}/timeout`, { signal: AbortSignal.timeout(100) }));
    await assert.rejects(new Promise((resolve, reject) => httpsGet(`${fixture.httpsUrl}/tls`, resolve).on('error', reject)), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  } finally {
    await fixture.close();
  }
});
