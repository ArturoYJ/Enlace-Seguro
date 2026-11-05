export const MAX_ANALYSIS_INPUT_LENGTH = 480;

export type AnalysisInputError = 'too_long' | 'missing_url' | 'multiple_urls' | 'invalid_url';

export type AnalysisInputResult =
  | { ok: true; url: string }
  | { ok: false; reason: AnalysisInputError };

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`]*/gi;
const TRAILING_SENTENCE_PUNCTUATION = /[.,!?;:…。！？]+$/u;

function trimSentencePunctuation(value: string): string {
  let candidate = value.replace(TRAILING_SENTENCE_PUNCTUATION, '');
  const pairs = [['(', ')'], ['[', ']'], ['{', '}']] as const;

  for (const [opening, closing] of pairs) {
    while (
      candidate.endsWith(closing) &&
      candidate.split(closing).length > candidate.split(opening).length
    ) {
      candidate = candidate.slice(0, -1);
    }
  }

  return candidate;
}

/** Extract one HTTP(S) destination locally; never return the surrounding message. */
export function extractAnalysisUrl(input: string): AnalysisInputResult {
  if (input.length > MAX_ANALYSIS_INPUT_LENGTH) return { ok: false, reason: 'too_long' };

  const matches = input.match(HTTP_URL_PATTERN) ?? [];
  const candidates = matches.map((match) => trimSentencePunctuation(match.trim())).filter(Boolean);
  if (candidates.length === 0) return { ok: false, reason: 'missing_url' };
  if (candidates.length !== 1) return { ok: false, reason: 'multiple_urls' };

  const candidate = candidates[0];
  try {
    const parsed = new URL(candidate);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      return { ok: false, reason: 'invalid_url' };
    }
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  return { ok: true, url: candidate };
}
