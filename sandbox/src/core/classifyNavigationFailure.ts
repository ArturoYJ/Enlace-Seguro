/** Returns true only for Chromium's stable certificate-validation error family. */
export function isTlsCertificateValidationError(error: unknown): boolean {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return /(?:net::)?ERR_CERT_[A-Z0-9_]+/.test(message);
}

/** Maps browser failures to non-sensitive signals; Playwright errors can contain URLs. */
export function classifyNavigationFailure(error: unknown, ssrfDetectedInFlight = false): string {
  const message = error instanceof Error ? error.message : '';
  if (message.toLowerCase().includes('timeout')) return 'navigation_timeout';
  if (message.includes('BLOCKED_BY_CLIENT') || ssrfDetectedInFlight) return 'ssrf_attempt_blocked';
  return 'navigation_failed';
}
