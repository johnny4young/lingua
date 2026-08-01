import type { Language } from '../types';
import type { ExecutionError } from '../types/execution';
import {
  isStickyLineResult,
  stickyLineResultKey,
  type LineResult,
  type ResultSnapshot,
} from '../stores/resultStore';
import { magicCommentKindsByLine } from '../utils/magicComments';

interface PreserveStickyLineResultsOptions {
  autoLogEnabled: boolean;
  code: string;
  error: ExecutionError;
  language: Language;
  lineResults: LineResult[];
  previousSnapshot: ResultSnapshot | null;
}

/** Keep only source-identical sticky values whose failed run errored elsewhere. */
export function preserveStickyLineResults({
  autoLogEnabled,
  code,
  error,
  language,
  lineResults,
  previousSnapshot,
}: PreserveStickyLineResultsOptions): LineResult[] {
  if (previousSnapshot?.language !== language) return lineResults;

  const stickyCandidates = previousSnapshot.lineResults.filter(
    isStickyLineResult
  );
  if (stickyCandidates.length === 0) return lineResults;

  const currentKinds = currentStickyKinds(language, code, autoLogEnabled);
  const sourceLines = code.split('\n');
  const freshStickyLines = new Set(
    lineResults.filter(isStickyLineResult).map(stickyLineResultKey)
  );
  const persistedSticky = stickyCandidates.filter(
    (entry) =>
      !errorTouchesLine(error, entry.line) &&
      currentKinds[entry.line] === entry.type &&
      previousSnapshot.stickySourceLines?.[stickyLineResultKey(entry)] ===
        (sourceLines[entry.line - 1] ?? '') &&
      !freshStickyLines.has(stickyLineResultKey(entry))
  );

  return persistedSticky.length > 0
    ? [...lineResults, ...persistedSticky]
    : lineResults;
}

function errorTouchesLine(error: ExecutionError, line: number): boolean {
  const startLine = error.line;
  if (
    typeof startLine !== 'number' ||
    !Number.isInteger(startLine) ||
    startLine < 1
  ) {
    return true;
  }

  const endCandidate = error.endLine;
  const endLine =
    typeof endCandidate === 'number' &&
    Number.isInteger(endCandidate) &&
    endCandidate >= startLine
      ? endCandidate
      : startLine;
  return line >= startLine && line <= endLine;
}

function currentStickyKinds(
  language: Language,
  code: string,
  autoLogEnabled: boolean
): Record<number, 'arrow' | 'watch' | 'autoLog'> {
  if (!isMagicCommentLanguage(language)) return {};
  return magicCommentKindsByLine(language, code, {
    autoLog: autoLogEnabled,
  });
}

function isMagicCommentLanguage(
  language: Language
): language is 'javascript' | 'typescript' | 'python' {
  return (
    language === 'javascript' ||
    language === 'typescript' ||
    language === 'python'
  );
}
