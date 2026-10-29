import { chromium, Browser, BrowserContext } from 'playwright';
import { AntiSsrfGuard } from '../core/AntiSsrfGuard.js';
import { VerdictEvaluator, Verdict } from '../core/VerdictEvaluator.js';
import { IScreenshotStorage } from './ScreenshotStorage.js';

export interface SandboxExecutionResult {
  attemptId: string;
  targetUrl: string;
  finalDestination: string;
  redirects: string[];
  signals: string[];
  verdict: Verdict;
  reasons: string[];
  screenshotRef?: string;
  sourceResults: Array<{
    sourceName: string;
    status: string;
    checkedAt: Date;
    expiresAt: Date;
    summary: string;
  }>;
}

export class PlaywrightContextPool {
  private browser: Browser | null = null;
  private activeJobs = 0;
  private readonly maxConcurrency: number;
  private readonly executablePath?: string;

  constructor(
    private readonly screenshotStorage: IScreenshotStorage,
    maxConcurrency = 3,
    executablePath?: string
  ) {
    this.maxConcurrency = maxConcurrency;
    this.executablePath =
      executablePath ||
      process.env['CHROME_EXECUTABLE_PATH'] ||
      (process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : undefined);
  }

  public async init(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        executablePath: this.executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
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
      });
    }
  }

  public async analyzeUrl(attemptId: string, targetUrl: string): Promise<SandboxExecutionResult> {
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
    const dnsCheck = await AntiSsrfGuard.validateDestination(preflight.parsedUrl);
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
    while (this.activeJobs >= this.maxConcurrency) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.activeJobs++;

    let context: BrowserContext | null = null;
    const redirects: string[] = [];
    const signals: string[] = [];
    let screenshotRef: string | undefined = undefined;
    let finalDestination = targetUrl;
    let ssrfDetectedInFlight = false;
    let ssrfInFlightReason: string | undefined = undefined;

    try {
      await this.init();
      if (!this.browser) {
        throw new Error('Browser failed to initialize');
      }

      context = await this.browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EnlaceSeguroBot/1.0',
        viewport: { width: 1280, height: 800 },
        javaScriptEnabled: true,
        bypassCSP: false,
        ignoreHTTPSErrors: true,
        permissions: []
      });

      // Intercept all network traffic for Anti-SSRF and signal logging
      await context.route('**', async (route) => {
        const reqUrl = route.request().url();
        const check = AntiSsrfGuard.isSafeUrl(reqUrl);

        if (!check.valid || !check.parsedUrl) {
          ssrfDetectedInFlight = true;
          ssrfInFlightReason = check.reason;
          await route.abort('blockedbyclient');
          return;
        }

        // Quick private IP check on destination
        const destCheck = await AntiSsrfGuard.validateDestination(check.parsedUrl);
        if (!destCheck.safe) {
          ssrfDetectedInFlight = true;
          ssrfInFlightReason = destCheck.reason;
          await route.abort('blockedbyclient');
          return;
        }

        await route.continue();
      });

      const page = await context.newPage();

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
        const status = response.status();
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = response.headers()['location'];
          if (location && !redirects.includes(location)) {
            redirects.push(location);
          }
        }
      });

      // Navigate to target URL with timeout
      try {
        await page.goto(targetUrl, {
          timeout: 15000,
          waitUntil: 'domcontentloaded'
        });
        finalDestination = page.url();
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Navigation error';
        if (errMsg.includes('timeout')) {
          signals.push('navigation_timeout');
        } else if (errMsg.includes('BLOCKED_BY_CLIENT') || ssrfDetectedInFlight) {
          signals.push('ssrf_attempt_blocked');
        } else {
          signals.push(`navigation_failed: ${errMsg.slice(0, 100)}`);
        }
      }

      // DOM Signals Inspection
      if (!ssrfDetectedInFlight) {
        try {
          const domSignals = await page.evaluate(() => {
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
          });

          signals.push(...domSignals);
        } catch {
          // Page may have closed or crashed
        }

        // Capture Screenshot
        try {
          const screenshotBuffer = await page.screenshot({
            type: 'png',
            fullPage: false
          });
          screenshotRef = await this.screenshotStorage.saveScreenshot(attemptId, screenshotBuffer);
        } catch {
          // Screenshot failed
        }
      }
    } finally {
      if (context) {
        await context.close();
      }
      this.activeJobs--;
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
          summary: `Análisis de comportamiento completado en navegador aislado con ${redirects.length} redirecciones.`
        }
      ]
    };
  }

  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
