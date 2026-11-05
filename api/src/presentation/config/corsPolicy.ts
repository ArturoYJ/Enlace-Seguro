export function parseCorsAllowedOrigins(raw: string, production: boolean): string[] {
  if (!raw.trim()) return [];

  const origins = raw.split(',').map((value) => value.trim());
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('CORS_ALLOWED_ORIGINS must contain exact HTTP(S) origins.');
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (origin !== parsed.origin || parsed.username || parsed.password ||
        (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && !production && loopback))) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain exact HTTPS origins, or local HTTP origins outside production.');
    }
  }

  return [...new Set(origins)];
}
