import { ISandboxService, SandboxAnalysisOutput } from '../../core/ports/ISandboxService.js';
import { Verdict } from '../../core/entities/Analysis.js';

export class HttpSandboxService implements ISandboxService {
  constructor(private readonly baseUrl = 'http://localhost:3001') {}

  public async analyze(attemptId: string, url: string): Promise<SandboxAnalysisOutput> {
    const response = await fetch(`${this.baseUrl}/analyze`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ attemptId, url })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Sandbox service error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
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
        checkedAt: string;
        expiresAt: string;
        summary?: string;
      }>;
    };

    return {
      attemptId: data.attemptId,
      targetUrl: data.targetUrl,
      finalDestination: data.finalDestination,
      redirects: data.redirects,
      signals: data.signals,
      verdict: data.verdict,
      reasons: data.reasons,
      screenshotRef: data.screenshotRef,
      sourceResults: data.sourceResults.map((s) => ({
        sourceName: s.sourceName,
        status: s.status,
        checkedAt: new Date(s.checkedAt),
        expiresAt: new Date(s.expiresAt),
        summary: s.summary
      }))
    };
  }

  public async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
