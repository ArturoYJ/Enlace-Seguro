import { Verdict, SourceResult } from '../entities/Analysis.js';

interface SandboxAnalysisCommon {
  attemptId: string;
  targetUrl: string;
  finalDestination: string;
  redirects: string[];
  signals: string[];
  sourceResults: SourceResult[];
}

export type SandboxAnalysisOutput = SandboxAnalysisCommon & (
  | { outcome: 'completed'; verdict: Verdict; reasons: string[]; screenshotRef?: string }
  | { outcome: 'inconclusive'; reasonCode: 'tls_certificate_invalid' | 'resource_limit_exceeded' }
);

export interface ISandboxService {
  analyze(attemptId: string, url: string): Promise<SandboxAnalysisOutput>;
  getCapture(attemptId: string): Promise<Uint8Array | null>;
  isHealthy(): Promise<boolean>;
}
