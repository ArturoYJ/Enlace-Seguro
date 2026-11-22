import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { AntiSsrfGuard } from '../core/AntiSsrfGuard.js';
import { VerdictEvaluator, Verdict } from '../core/VerdictEvaluator.js';
import { classifyNavigationFailure, isTlsCertificateValidationError } from '../core/classifyNavigationFailure.js';
import { IScreenshotStorage } from './ScreenshotStorage.js';
import { analyzeProbe, Canary, carriesCanary, classifyFollowUpField, createCanary, FollowUpKind } from '../core/CredentialProbe.js';
import { createPlaywrightContextOptions, resolveEgressProxySettings } from './playwrightContextOptions.js';

const MAX_RECORDED_REDIRECT_LOCATIONS = 10;
const MAX_BROWSER_REQUESTS_PER_ANALYSIS = 256;
// Prueba con credenciales inventadas: tiempo y peticiones propias, separadas del análisis principal.
const CREDENTIAL_PROBE_MAX_MS = 6_000;
const CREDENTIAL_PROBE_MIN_REMAINING_MS = CREDENTIAL_PROBE_MAX_MS + 4_000;
const CREDENTIAL_PROBE_MAX_REQUESTS = 64;
const MAX_RECORDED_EXFILTRATION_URLS = 10;

interface CredentialProbeState {
  started: boolean;
  canary: Canary | null;
  requestCount: number;
  exfiltrationUrls: string[];
}

interface SandboxExecutionCommon {
  attemptId: string;
  targetUrl: string;
  finalDestination: string;
  redirects: string[];
  signals: string[];
  sourceResults: Array<{
    sourceName: string;
    status: string;
    checkedAt: Date;
    expiresAt: Date;
    summary: string;
  }>;
}

export type SandboxExecutionResult = SandboxExecutionCommon & (
  | { outcome: 'completed'; verdict: Verdict; reasons: string[]; screenshotRef?: string }
  | { outcome: 'inconclusive'; reasonCode: 'tls_certificate_invalid' | 'resource_limit_exceeded' | 'dns_unavailable' | 'dom_inspection_failed' }
);

export class SandboxCapacityError extends Error {
  constructor() {
    super('Sandbox capacity is temporarily exhausted.');
    this.name = 'SandboxCapacityError';
  }
}

export class SandboxAnalysisTimeoutError extends Error {
  constructor() {
    super('Sandbox analysis exceeded its global deadline.');
    this.name = 'SandboxAnalysisTimeoutError';
  }
}

export class SandboxNavigationError extends Error {
  constructor() {
    super('Sandbox navigation could not be completed.');
    this.name = 'SandboxNavigationError';
  }
}

interface QueuedJob {
  resolve: () => void;
  reject: (error: Error) => void;
  onAbort: () => void;
}

function timeoutError(signal: AbortSignal): Error {
  return signal.reason instanceof SandboxAnalysisTimeoutError
    ? signal.reason
    : new SandboxAnalysisTimeoutError();
}

function awaitBeforeDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(timeoutError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(timeoutError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
    if (signal.aborted) onAbort();
  });
}

export class PlaywrightContextPool {
  private browser: Browser | null = null;
  private browserInitialization: Promise<Browser> | null = null;
  private activeJobs = 0;
  private readonly queuedJobs: QueuedJob[] = [];
  private readonly maxQueuedJobs: number;
  private readonly idempotentJobs = new Map<string, { targetUrl: string; promise: Promise<SandboxExecutionResult>; completedAt?: number }>();
  private readonly maxConcurrency: number;
  private readonly executablePath?: string;
  private readonly egressProxy: ReturnType<typeof resolveEgressProxySettings>;

  constructor(
    private readonly screenshotStorage: IScreenshotStorage,
    maxConcurrency = 3,
    executablePath?: string,
    maxQueuedJobs = maxConcurrency * 2,
    private readonly analysisDeadlineMs = 25_000,
    private readonly credentialProbeEnabled = false
  ) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 32) {
      throw new Error('Sandbox max concurrency must be an integer between 1 and 32.');
    }
    if (!Number.isInteger(maxQueuedJobs) || maxQueuedJobs < 0 || maxQueuedJobs > 256) {
      throw new Error('Sandbox max queued jobs must be an integer between 0 and 256.');
    }
    if (!Number.isInteger(analysisDeadlineMs) || analysisDeadlineMs < 1 || analysisDeadlineMs > 28_000) {
      throw new Error('Sandbox analysis deadline must be an integer between 1 and 28000 milliseconds.');
    }
    this.maxConcurrency = maxConcurrency;
    this.maxQueuedJobs = maxQueuedJobs;
    this.egressProxy = resolveEgressProxySettings();
    this.executablePath =
      executablePath ||
      process.env['CHROME_EXECUTABLE_PATH'] ||
      (process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : undefined);
  }

  public async init(timeoutMs = this.analysisDeadlineMs): Promise<void> {
    if (this.browser) return;
    if (!this.browserInitialization) {
      this.browserInitialization = chromium.launch({
        headless: true,
        timeout: timeoutMs,
        // Keep Chromium's process sandbox enabled. Production containers must run as a
        // non-root user with the required user-namespace/seccomp support.
        chromiumSandbox: true,
        executablePath: this.executablePath,
        args: [
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-sync',
          '--disable-translate',
          '--mute-audio',
          '--no-first-run',
          '--safebrowsing-disable-auto-update'
        ]
      }).then((browser) => {
        this.browser = browser;
        return browser;
      }).finally(() => {
        this.browserInitialization = null;
      });
    }
    await this.browserInitialization;
  }

  public async analyzeUrl(attemptId: string, targetUrl: string): Promise<SandboxExecutionResult> {
    const now = Date.now();
    for (const [id, entry] of this.idempotentJobs) {
      if (entry.completedAt !== undefined && now - entry.completedAt > 10 * 60_000) this.idempotentJobs.delete(id);
    }
    if (this.idempotentJobs.size >= 5_000) {
      for (const [id, entry] of this.idempotentJobs) {
        if (entry.completedAt !== undefined) this.idempotentJobs.delete(id);
        if (this.idempotentJobs.size < 5_000) break;
      }
    }
    if (this.idempotentJobs.size >= 5_000) throw new SandboxCapacityError();
    const existing = this.idempotentJobs.get(attemptId);
    if (existing) {
      if (existing.targetUrl !== targetUrl) throw new Error('Idempotency conflict for analysis attempt.');
      return existing.promise;
    }

    const entry: { targetUrl: string; promise: Promise<SandboxExecutionResult>; completedAt?: number } = {
      targetUrl,
      promise: Promise.resolve(undefined as never)
    };
    const deadline = new AbortController();
    const deadlineTimer = setTimeout(() => deadline.abort(new SandboxAnalysisTimeoutError()), this.analysisDeadlineMs);
    const deadlineAt = Date.now() + this.analysisDeadlineMs;
    entry.promise = awaitBeforeDeadline(
      Promise.resolve().then(() => this.runAnalysis(attemptId, targetUrl, deadline.signal, deadlineAt)),
      deadline.signal
    ).finally(() => {
      clearTimeout(deadlineTimer);
    });
    this.idempotentJobs.set(attemptId, entry);
    try {
      const result = await entry.promise;
      entry.completedAt = Date.now();
      return result;
    } catch (error) {
      if (this.idempotentJobs.get(attemptId) === entry) this.idempotentJobs.delete(attemptId);
      throw error;
    }
  }

  private async runAnalysis(attemptId: string, targetUrl: string, signal: AbortSignal, deadlineAt: number): Promise<SandboxExecutionResult> {
    let slotAcquired = false;
    let context: BrowserContext | null = null;
    let closeContextPromise: Promise<void> | null = null;
    let pendingContextCleanup: Promise<void | undefined> | null = null;
    const closeContext = () => {
      if (!context) return Promise.resolve();
      closeContextPromise ??= context.close().catch(() => undefined);
      return closeContextPromise;
    };
    const onAbort = () => { void closeContext(); };
    signal.addEventListener('abort', onAbort);

    try {
    // 1. Static Anti-SSRF Preflight
    const preflight = AntiSsrfGuard.isSafeUrl(targetUrl);
    if (!preflight.valid || !preflight.parsedUrl) {
      const evaluation = VerdictEvaluator.evaluate({
        targetUrl,
        finalDestination: targetUrl,
        redirects: [],
        signals: ['malformed_or_disallowed_url'],
        blockedSsrf: true,
        ssrfReason: preflight.reason
      });

      return {
        outcome: 'completed',
        attemptId,
        targetUrl,
        finalDestination: targetUrl,
        redirects: [],
        signals: evaluation.signals,
        verdict: evaluation.verdict,
        reasons: evaluation.reasons,
        sourceResults: [
          {
            sourceName: 'SandboxStaticValidator',
            status: 'flagged',
            checkedAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            summary: preflight.reason || 'Invalid URL'
          }
        ]
      };
    }

    // 2. DNS Destination Preflight
    const dnsCheck = await awaitBeforeDeadline(AntiSsrfGuard.validateDestination(preflight.parsedUrl), signal);
    if (!dnsCheck.safe && dnsCheck.reasonCode === 'dns_unavailable') {
      return { outcome: 'inconclusive', reasonCode: 'dns_unavailable', attemptId, targetUrl,
        finalDestination: targetUrl, redirects: [], signals: ['dns_unavailable'], sourceResults: [] };
    }
    if (!dnsCheck.safe) {
      const evaluation = VerdictEvaluator.evaluate({
        targetUrl,
        finalDestination: targetUrl,
        redirects: [],
        signals: ['ssrf_private_ip_target'],
        blockedSsrf: true,
        ssrfReason: dnsCheck.reason
      });

      return {
        outcome: 'completed',
        attemptId,
        targetUrl,
        finalDestination: targetUrl,
        redirects: [],
        signals: evaluation.signals,
        verdict: evaluation.verdict,
        reasons: evaluation.reasons,
        sourceResults: [
          {
            sourceName: 'AntiSsrfGuard',
            status: 'flagged',
            checkedAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            summary: dnsCheck.reason || 'SSRF target rejected'
          }
        ]
      };
    }

    // 3. Acquire Semaphore Slot
    await this.acquireSlot(signal);
    slotAcquired = true;

    const redirects: string[] = [];
    const signals: string[] = [];
    let screenshotRef: string | undefined = undefined;
    let screenshotBuffer: Buffer | undefined = undefined;
    let finalDestination = targetUrl;
    let ssrfDetectedInFlight = false;
    let tlsCertificateInvalid = false;
    let egressProxyError = false;
    let resourceLimitExceeded = false;
    let dnsUnavailable = false;
    let domInspectionFailed = false;
    let browserRequestCount = 0;
    let ssrfInFlightReason: string | undefined = undefined;
    // Mientras dura la prueba de credenciales sus peticiones no cambian el estado del análisis principal:
    // un destino bloqueado o sin DNS al que la página intenta mandar los datos es evidencia, no un fallo.
    const probe: CredentialProbeState = { started: false, canary: null, requestCount: 0, exfiltrationUrls: [] };
    const registerBrowserRequest = (): boolean => {
      browserRequestCount += 1;
      if (browserRequestCount <= MAX_BROWSER_REQUESTS_PER_ANALYSIS) return true;
      resourceLimitExceeded = true;
      void closeContext();
      return false;
    };

      await awaitBeforeDeadline(this.init(Math.max(1, deadlineAt - Date.now())), signal);
      if (!this.browser) {
        throw new Error('Browser failed to initialize');
      }

      const contextPromise = this.browser.newContext(createPlaywrightContextOptions(this.egressProxy));
      pendingContextCleanup = contextPromise.then(async (created) => {
        context = created;
        if (signal.aborted) await closeContext();
      }).catch(() => undefined);
      context = await awaitBeforeDeadline(contextPromise, signal);
      if (signal.aborted) throw timeoutError(signal);

      // Intercept all network traffic for Anti-SSRF and signal logging
      await awaitBeforeDeadline(context.route('**', async (route) => {
        const probeRequest = probe.started;
        if (probeRequest) {
          probe.requestCount += 1;
          if (probe.requestCount > CREDENTIAL_PROBE_MAX_REQUESTS) {
            await route.abort('blockedbyclient').catch(() => undefined);
            return;
          }
          // Se revisa antes de los filtros: intentar mandar los datos ya es la evidencia buscada.
          const request = route.request();
          let body: string | null = null;
          try { body = request.postData(); } catch { body = null; }
          if (probe.canary && carriesCanary(probe.canary, request.url(), body) &&
              probe.exfiltrationUrls.length < MAX_RECORDED_EXFILTRATION_URLS) {
            probe.exfiltrationUrls.push(request.url());
          }
        } else {
          if (resourceLimitExceeded) {
            await route.abort('blockedbyclient').catch(() => undefined);
            return;
          }
          if (!registerBrowserRequest()) {
            await route.abort('blockedbyclient').catch(() => undefined);
            return;
          }
        }

        const reqUrl = route.request().url();
        const check = AntiSsrfGuard.isSafeUrl(reqUrl);

        if (!check.valid || !check.parsedUrl) {
          if (!probeRequest) {
            ssrfDetectedInFlight = true;
            ssrfInFlightReason = check.reason;
          }
          await route.abort('blockedbyclient');
          return;
        }

        // Quick private IP check on destination
        let destCheck;
        try {
          destCheck = await awaitBeforeDeadline(AntiSsrfGuard.validateDestination(check.parsedUrl), signal);
        } catch (error: unknown) {
          if (signal.aborted) {
            await route.abort('aborted').catch(() => undefined);
            return;
          }
          throw error;
        }
        if (!destCheck.safe) {
          if (probeRequest) {
            await route.abort('blockedbyclient');
            return;
          }
          if (destCheck.reasonCode === 'dns_unavailable') {
            dnsUnavailable = true;
            await route.abort('blockedbyclient');
            return;
          }
          ssrfDetectedInFlight = true;
          ssrfInFlightReason = destCheck.reason;
          await route.abort('blockedbyclient');
          return;
        }

        if (resourceLimitExceeded && !probeRequest) {
          await route.abort('blockedbyclient').catch(() => undefined);
          return;
        }

        await route.continue();
      }), signal);

      // WebSockets use a separate Playwright interception API and must not bypass the per-analysis budget.
      // They are intentionally blocked: the HTTP Anti-SSRF validator does not accept ws:/wss: destinations.
      await awaitBeforeDeadline(context.routeWebSocket('**', async (webSocket) => {
        if (!probe.started && !registerBrowserRequest()) {
          await webSocket.close({ code: 1008, reason: 'Analysis resource limit exceeded' }).catch(() => undefined);
          return;
        }
        signals.push('websocket_blocked');
        await webSocket.close({ code: 1008, reason: 'WebSocket traffic is not inspected' }).catch(() => undefined);
      }), signal);

      const page = await awaitBeforeDeadline(context.newPage(), signal);

      // A failed main document or subresource with a Chromium certificate error invalidates inspection.
      page.on('requestfailed', (request) => {
        if (!probe.started && isTlsCertificateValidationError(request.failure()?.errorText)) {
          tlsCertificateInvalid = true;
        }
      });

      // Handle downloads
      page.on('download', async (download) => {
        signals.push('download_attempt_blocked');
        await download.cancel();
      });

      // Dismiss dialogs/popups
      page.on('dialog', async (dialog) => {
        signals.push('dialog_popup_blocked');
        await dialog.dismiss();
      });

      // Record HTTP redirects
      page.on('response', (response) => {
        // Lo que pase durante la prueba de credenciales no altera la evidencia de la navegación original.
        if (probe.started) return;
        if (response.headers()['x-enlaceseguro-egress-error']?.trim().toLowerCase() === 'true') {
          egressProxyError = true;
          void closeContext();
        }
        const status = response.status();
        const request = response.request();
        if ([301, 302, 303, 307, 308].includes(status) && request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          const location = response.headers()['location'];
          if (location) {
            if (redirects.length < MAX_RECORDED_REDIRECT_LOCATIONS) {
              redirects.push(location);
            } else if (!signals.includes('redirect_evidence_truncated')) {
              signals.push('redirect_evidence_truncated');
            }
          }
        }
      });

      // Navigate to target URL with timeout
      try {
        await awaitBeforeDeadline(page.goto(targetUrl, {
          timeout: 15000,
          waitUntil: 'load'
        }), signal);
        finalDestination = page.url();
      } catch (err: unknown) {
        if (egressProxyError) throw new SandboxNavigationError();
        if (signal.aborted) throw timeoutError(signal);
        if (!resourceLimitExceeded && !dnsUnavailable) {
          if (isTlsCertificateValidationError(err)) {
            tlsCertificateInvalid = true;
          } else {
            const failureSignal = classifyNavigationFailure(err, ssrfDetectedInFlight);
            if (failureSignal === 'ssrf_attempt_blocked') {
              signals.push(failureSignal);
            } else if (failureSignal === 'navigation_timeout') {
              throw new SandboxAnalysisTimeoutError();
            } else {
              throw new SandboxNavigationError();
            }
          }
        }
      }

      if (egressProxyError) throw new SandboxNavigationError();

      // DOM Signals Inspection
      if (!ssrfDetectedInFlight && !tlsCertificateInvalid && !resourceLimitExceeded && !dnsUnavailable) {
        try {
          const domSignals = await awaitBeforeDeadline(page.evaluate(() => {
            const detected: string[] = [];

            // 1. Password input check
            const passwordInputs = document.querySelectorAll('input[type="password"]');
            if (passwordInputs.length > 0) {
              if (window.location.protocol === 'http:') {
                detected.push('password_input_on_http');
              } else {
                detected.push('password_input_present');
              }
            }

            // 2. Hidden iframes check
            const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
            for (const iframe of iframes) {
              const style = window.getComputedStyle(iframe);
              if (
                style.display === 'none' ||
                style.visibility === 'hidden' ||
                iframe.width === '0' ||
                iframe.height === '0'
              ) {
                detected.push('hidden_iframe_detected');
                break;
              }
            }

            // 3. Cross-origin form submission
            const forms = Array.from(document.querySelectorAll<HTMLFormElement>('form'));
            const currentHost = window.location.hostname;
            for (const form of forms) {
              const action = form.getAttribute('action');
              if (action && (action.startsWith('http://') || action.startsWith('https://'))) {
                try {
                  const formHost = new URL(action).hostname;
                  if (formHost !== currentHost) {
                    detected.push('cross_origin_form_action');
                    break;
                  }
                } catch {
                  // ignore
                }
              }
            }

            return detected;
          }), signal);

          signals.push(...domSignals);
        } catch (error: unknown) {
          if (signal.aborted) throw timeoutError(signal);
          domInspectionFailed = true;
        }

        // Capture Screenshot
        try {
          if (domInspectionFailed) throw new Error('DOM inspection failed');
          screenshotBuffer = await awaitBeforeDeadline(page.screenshot({
            type: 'webp',
            fullPage: false
          }), signal);
          if (signal.aborted) throw timeoutError(signal);
        } catch (error: unknown) {
          if (signal.aborted) throw timeoutError(signal);
          // Screenshot failed
        }

        // Prueba con credenciales inventadas: solo si está activada, hay un campo de contraseña y queda tiempo.
        const hasPasswordField = signals.includes('password_input_present') || signals.includes('password_input_on_http');
        if (this.credentialProbeEnabled && hasPasswordField && !domInspectionFailed && !egressProxyError) {
          if (deadlineAt - Date.now() < CREDENTIAL_PROBE_MIN_REMAINING_MS) {
            signals.push('credential_probe_skipped_time');
          } else {
            probe.canary = createCanary();
            probe.started = true;
            const outcome = await this.probeCredentials(page, probe.canary, signal);
            const analysis = analyzeProbe({
              pageUrl: finalDestination,
              submitted: outcome.submitted,
              exfiltrationUrls: probe.exfiltrationUrls,
              followUpKinds: outcome.followUpKinds,
              urlAfterSubmit: outcome.urlAfterSubmit
            });
            signals.push(...analysis.signals);
          }
        }
      }
      if (egressProxyError) throw new SandboxNavigationError();
    // Stop browser traffic before persisting the screenshot so a late TLS failure cannot leave a capture behind.
    await closeContext();
    if (signal.aborted) throw timeoutError(signal);
    if (egressProxyError) throw new SandboxNavigationError();
    if (resourceLimitExceeded) {
      return {
        outcome: 'inconclusive',
        reasonCode: 'resource_limit_exceeded',
        attemptId,
        targetUrl,
        finalDestination: targetUrl,
        redirects: [],
        signals: ['browser_request_limit_exceeded'],
        sourceResults: []
      };
    }
    if (dnsUnavailable || domInspectionFailed) {
      const reasonCode = dnsUnavailable ? 'dns_unavailable' : 'dom_inspection_failed';
      return { outcome: 'inconclusive', reasonCode, attemptId, targetUrl, finalDestination: targetUrl,
        redirects: [], signals: [reasonCode], sourceResults: [] };
    }
    if (tlsCertificateInvalid) {
      return {
        outcome: 'inconclusive',
        reasonCode: 'tls_certificate_invalid',
        attemptId,
        targetUrl,
        finalDestination: targetUrl,
        redirects: [],
        signals: ['tls_certificate_validation_failed'],
        sourceResults: []
      };
    }
    if (screenshotBuffer) {
      try {
        screenshotRef = await awaitBeforeDeadline(
          this.screenshotStorage.saveScreenshot(attemptId, screenshotBuffer),
          signal
        );
      } catch (error: unknown) {
        if (signal.aborted) throw timeoutError(signal);
        // Screenshot persistence is best-effort; analysis verdict remains independent.
      }
    }

    // 4. Final Verdict Evaluation
    const evaluation = VerdictEvaluator.evaluate({
      targetUrl,
      finalDestination,
      redirects,
      signals,
      blockedSsrf: ssrfDetectedInFlight,
      ssrfReason: ssrfInFlightReason
    });

    return {
      outcome: 'completed',
      attemptId,
      targetUrl,
      finalDestination,
      redirects,
      signals: evaluation.signals,
      verdict: evaluation.verdict,
      reasons: evaluation.reasons,
      screenshotRef,
      sourceResults: [
        {
          sourceName: 'PlaywrightIsolatedSandbox',
          status: evaluation.verdict === 'peligroso' ? 'flagged' : 'inspected',
          checkedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          summary: 'Análisis de comportamiento completado en navegador aislado.'
        }
      ]
    };
    } finally {
      signal.removeEventListener('abort', onAbort);
      await pendingContextCleanup;
      await closeContext();
      if (slotAcquired) this.releaseSlot();
    }
  }

  /**
   * Llena el primer formulario con contraseña usando la credencial inventada, lo envía y revisa
   * qué pide la página después. No lanza errores salvo el de tiempo agotado: si algo no se puede
   * hacer, devuelve lo que alcanzó a observar.
   */
  private async probeCredentials(page: Page, canary: Canary, signal: AbortSignal):
    Promise<{ submitted: boolean; followUpKinds: FollowUpKind[]; urlAfterSubmit?: string }> {
    const stepTimeout = 1_500;
    const startedAt = Date.now();
    const remaining = () => Math.max(1, CREDENTIAL_PROBE_MAX_MS - (Date.now() - startedAt));
    try {
      const password = page.locator('input[type="password"]:visible').first();
      if (await awaitBeforeDeadline(password.count(), signal) === 0) return { submitted: false, followUpKinds: [] };

      const form = password.locator('xpath=ancestor::form[1]');
      const scope = await awaitBeforeDeadline(form.count(), signal) > 0 ? form : page.locator('body');
      const identity = scope.locator([
        'input[type="email"]:visible', 'input[type="text"]:visible', 'input[type="tel"]:visible',
        'input:not([type]):visible'
      ].join(', ')).first();
      if (await awaitBeforeDeadline(identity.count(), signal) > 0) {
        await awaitBeforeDeadline(identity.fill(canary.identity, { timeout: stepTimeout }), signal);
      }
      await awaitBeforeDeadline(password.fill(canary.password, { timeout: stepTimeout }), signal);

      const urlBefore = page.url();
      await awaitBeforeDeadline(password.press('Enter', { timeout: stepTimeout }), signal);
      await awaitBeforeDeadline(page.waitForLoadState('networkidle', { timeout: Math.min(2_500, remaining()) }).catch(() => undefined), signal);

      // Algunas páginas no envían con Enter y esperan el clic en el botón.
      if (page.url() === urlBefore) {
        const button = scope.locator('button[type="submit"]:visible, input[type="submit"]:visible, button:not([type]):visible').first();
        if (await awaitBeforeDeadline(button.count(), signal) > 0) {
          await awaitBeforeDeadline(button.click({ timeout: stepTimeout }).catch(() => undefined), signal);
          await awaitBeforeDeadline(page.waitForLoadState('networkidle', { timeout: Math.min(2_500, remaining()) }).catch(() => undefined), signal);
        }
      }

      const fields = await awaitBeforeDeadline(page.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>('input'))
        .filter((input) => input.type !== 'hidden' && input.offsetParent !== null)
        .slice(0, 40)
        .map((input) => ({
          attributes: [input.name, input.id, input.placeholder, input.autocomplete, input.getAttribute('aria-label') ?? '',
            input.labels?.[0]?.textContent ?? '', input.type].join(' '),
          maxLength: input.maxLength
        }))), signal).catch((error: unknown) => {
        if (signal.aborted) throw error;
        return [] as Array<{ attributes: string; maxLength: number }>;
      });
      const followUpKinds = [...new Set(fields
        .map((field) => classifyFollowUpField(field.attributes, field.maxLength))
        .filter((kind): kind is FollowUpKind => kind !== null))];

      return { submitted: true, followUpKinds, urlAfterSubmit: page.url() };
    } catch (error: unknown) {
      if (signal.aborted) throw timeoutError(signal);
      return { submitted: false, followUpKinds: [] };
    }
  }

  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private async acquireSlot(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw timeoutError(signal);
    if (this.activeJobs < this.maxConcurrency) {
      this.activeJobs += 1;
      return;
    }
    if (this.queuedJobs.length >= this.maxQueuedJobs) throw new SandboxCapacityError();
    await new Promise<void>((resolve, reject) => {
      const queued: QueuedJob = {
        resolve: () => {
          signal.removeEventListener('abort', queued.onAbort);
          resolve();
        },
        reject,
        onAbort: () => {
          const index = this.queuedJobs.indexOf(queued);
          if (index >= 0) this.queuedJobs.splice(index, 1);
          reject(timeoutError(signal));
        }
      };
      this.queuedJobs.push(queued);
      signal.addEventListener('abort', queued.onAbort, { once: true });
      if (signal.aborted) queued.onAbort();
    });
  }

  private releaseSlot(): void {
    const next = this.queuedJobs.shift();
    if (next) next.resolve();
    else this.activeJobs -= 1;
  }
}
