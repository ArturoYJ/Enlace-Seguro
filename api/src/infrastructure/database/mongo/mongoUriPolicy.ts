/**
 * En producción la API habla con una base de datos remota (MongoDB Atlas), así que la conexión
 * debe ir cifrada. mongodb+srv:// activa TLS por defecto; con mongodb:// hay que pedir tls=true.
 * Se rechaza cualquier intento de apagarlo o de aceptar certificados inválidos.
 */
export function assertMongoUriPolicy(uri: string, environment = process.env['NODE_ENV'] ?? 'development'): void {
  if (environment !== 'production') return;
  let parsed: URL;
  try { parsed = new URL(uri); } catch { throw new Error('MONGODB_URI must be a valid MongoDB connection string.'); }
  const params = new URLSearchParams([...parsed.searchParams].map(([key, value]): [string, string] => [key.toLowerCase(), value.toLowerCase()]));
  const tlsFlag = params.get('tls') ?? params.get('ssl');
  const insecure = ['tlsallowinvalidcertificates', 'tlsallowinvalidhostnames', 'tlsinsecure']
    .some((key) => params.get(key) === 'true');
  const tlsOn = parsed.protocol === 'mongodb+srv:' ? tlsFlag !== 'false' : tlsFlag === 'true';
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || !tlsOn || insecure) {
    throw new Error('MONGODB_URI must use TLS with certificate validation in production (mongodb+srv:// or tls=true).');
  }
}
