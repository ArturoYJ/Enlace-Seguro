import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Loopback-only fixtures. These are not exceptions to the running Sandbox SSRF policy.
export async function startFixtures() {
  const key = await readFile(new URL('../../sandbox/browser-tests/fixtures/localhost.key.pem', import.meta.url));
  const cert = await readFile(new URL('../../sandbox/browser-tests/fixtures/localhost.cert.pem', import.meta.url));
  const handler = (req, res) => {
    if (req.url === '/timeout') return; // Deliberately wait until the client aborts.
    const pages = {
      '/clean': '<!doctype html><html><body><h1>Página de prueba</h1></body></html>',
      '/suspicious': '<!doctype html><html><body><form action="https://example.invalid/collect"><input type="password"></form><iframe title="oculto" style="display:none" srcdoc="fixture"></iframe></body></html>',
      '/tls': '<!doctype html><html><body><h1>Certificado de prueba no confiable</h1></body></html>',
    };
    const body = pages[req.url];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body ?? 'Not found');
  };
  const http = createHttpServer(handler);
  const https = createHttpsServer({ key, cert }, handler);
  const listen = server => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  try {
    const httpPort = await listen(http);
    const httpsPort = await listen(https);
    return {
      httpUrl: `http://127.0.0.1:${httpPort}`,
      httpsUrl: `https://127.0.0.1:${httpsPort}`,
      close: async () => {
        for (const server of [http, https]) server.closeAllConnections();
        await Promise.all([http, https].map(server => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()))));
      },
    };
  } catch (error) {
    for (const server of [http, https]) if (server.listening) server.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startFixtures();
  console.log(`Fixture HTTP: ${fixture.httpUrl}; TLS no confiable: ${fixture.httpsUrl}/tls`);
  const stop = async () => { await fixture.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
