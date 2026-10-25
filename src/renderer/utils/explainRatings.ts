/**
 * Helpful / Not helpful votes on explain answers, kept on this device only.
 * A vote stores the error's kind (TypeError, NameError…) and nothing else:
 * no code, no error text and no answer.
 */

const EXPLAIN_RATINGS_KEY = 'lingua-explain-ratings';
const MAX_RATINGS = 100;

export type ExplainVote = 'helpful' | 'not-helpful';

interface ExplainRating {
  at: number;
  kind: string;
  vote: ExplainVote;
}

/** The error's class name when the message starts with one, else `other`. */
function errorKindOf(message: string): string {
  const match = /^\s*([A-Z][A-Za-z]*(?:Error|Exception))\b/.exec(message);
  return match ? match[1]! : 'other';
}

function readExplainRatings(): ExplainRating[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(EXPLAIN_RATINGS_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as ExplainRating[]) : [];
  } catch {
    return [];
  }
}

export function recordExplainRating(vote: ExplainVote, errorMessage: string, now = Date.now()): void {
  try {
    const next = [...readExplainRatings(), { at: now, kind: errorKindOf(errorMessage), vote }].slice(-MAX_RATINGS);
    localStorage.setItem(EXPLAIN_RATINGS_KEY, JSON.stringify(next));
  } catch {
    // Storage may be full or blocked; a lost vote is harmless.
  }
}
