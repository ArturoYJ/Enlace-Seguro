import { Verdict, SourceResult } from '../entities/Analysis.js';

export interface SandboxAnalysisOutput {
  attemptId: string;
  targetUrl: string;
  finalDestination: string;
  redirects: string[];
  signals: string[];
  verdict: Verdict;
  reasons: string[];
  screenshotRef?: string;
  sourceResults: SourceResult[];
}

export interface ISandboxService {
  analyze(attemptId: string, url: string): Promise<SandboxAnalysisOutput>;
  isHealthy(): Promise<boolean>;
}
