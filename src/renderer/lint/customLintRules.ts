/**
 * RL-108 Slice 1 — custom JS/TS lint rules that Monaco's built-in TypeScript
 * worker does NOT provide (they are style/refactor concerns, not type errors).
 *
 * Monaco already ships live semantic + syntactic diagnostics and TS-native
 * quick-fixes (add/remove import, fix-typo) — see `applyTypeScriptDefaults` in
 * `src/renderer/monaco.ts`. This module adds only the gap:
 *
 *   - `strict-equality` — flags `==` / `!=` (loose equality) and offers
 *     `===` / `!==`. Surfaced as a `'lingua-lint'` marker (squiggle) + a
 *     quick-fix. This is the one rule with a diagnostic because loose equality
 *     is reliably detectable.
 *   - `add-semicolon` and `wrap-try-catch` — offered as cursor-anchored
 *     quick-fixes by `quickFixProvider.ts`, NOT as squiggles, because robust
 *     missing-semicolon / statement detection needs a full parse and would
 *     otherwise emit noisy false-positive squiggles.
 *
 * Everything here is pure (string in → findings out), so the rules are
 * exhaustively unit-tested without a Monaco instance. The scanner is
 * string/comment-aware and deliberately CONSERVATIVE: when in doubt it
 * under-fires (skips a match) rather than risk a false positive on the user's
 * code. Pinned by `tests/renderer/lint/customLintRules.test.ts`.
 */

/** Closed set of custom lint rule ids (mirrored in telemetry `ruleId`). */
export type CustomLintRuleId = 'strict-equality';

/**
 * A single lint finding with a 1-based Monaco-style range and the exact
 * replacement text for that range. Ranges are 1-based line/column because
 * that is what `monaco.editor.IMarkerData` and `IRange` expect.
 */
export interface LintIssue {
  ruleId: CustomLintRuleId;
  /** `===`/`!==` are style nits, surfaced as warnings (not errors). */
  severity: 'warning';
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  /** Human-facing message (already localized by the caller via the ruleId). */
  message: string;
  /** Replacement for the exact [start, end) range, e.g. `==` -> `===`. */
  fixText: string;
}

/** Languages the custom rules apply to. Everything else returns no issues. */
const SUPPORTED_LANGUAGES: ReadonlySet<string> = new Set(['javascript', 'typescript']);

type ScanState = 'code' | 'line-comment' | 'block-comment' | 'string';

/**
 * Convert an absolute character offset into a 1-based {line, column} using a
 * precomputed list of line-start offsets. Binary search keeps this O(log n)
 * per lookup so a file with thousands of operators stays cheap.
 */
function offsetToPosition(lineStarts: readonly number[], offset: number): {
  lineNumber: number;
  column: number;
} {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { lineNumber: lo + 1, column: offset - lineStarts[lo]! + 1 };
}

function computeLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/**
 * Find loose-equality operators (`==`, `!=`) outside strings and comments and
 * return a fix to the strict form (`===`, `!==`). The scanner tracks string
 * (', ", `) and comment (`//`, block) state with escape handling so equality
 * inside a string literal or comment never fires.
 *
 * Regex literals are NOT specially parsed (distinguishing `/` division from a
 * regex needs the full grammar); a `==` inside a regex is rare and the
 * conservative cost is a missed lint, never a wrong edit.
 *
 * @param source full buffer text
 * @param language Monaco language id; only `javascript` / `typescript` scan
 * @param messages localized strings keyed by what the operator becomes
 */
export function findLintIssues(
  source: string,
  language: string,
  messages: { strictEquality: string }
): LintIssue[] {
  if (!SUPPORTED_LANGUAGES.has(language) || source.length === 0) return [];

  const lineStarts = computeLineStarts(source);
  const issues: LintIssue[] = [];
  let state: ScanState = 'code';
  let stringQuote = '';

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    const next = i + 1 < source.length ? source[i + 1] : '';

    switch (state) {
      case 'code': {
        if (ch === '/' && next === '/') {
          state = 'line-comment';
          i += 1;
          continue;
        }
        if (ch === '/' && next === '*') {
          state = 'block-comment';
          i += 1;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
          state = 'string';
          stringQuote = ch;
          continue;
        }
        // Loose-equality detection. Guard against `===`, `!==`, `<=`, `>=`,
        // and `=>` by inspecting the neighbours.
        const prev = i > 0 ? source[i - 1] : '';
        if (ch === '=' && next === '=') {
          const after = i + 2 < source.length ? source[i + 2] : '';
          const isTripleOrPart = after === '=' || prev === '=' || prev === '!' || prev === '<' || prev === '>';
          if (!isTripleOrPart) {
            const start = offsetToPosition(lineStarts, i);
            const end = offsetToPosition(lineStarts, i + 2);
            issues.push({
              ruleId: 'strict-equality',
              severity: 'warning',
              startLineNumber: start.lineNumber,
              startColumn: start.column,
              endLineNumber: end.lineNumber,
              endColumn: end.column,
              message: messages.strictEquality,
              fixText: '===',
            });
            i += 1; // consume the second '='
            continue;
          }
        }
        if (ch === '!' && next === '=') {
          const after = i + 2 < source.length ? source[i + 2] : '';
          if (after !== '=') {
            const start = offsetToPosition(lineStarts, i);
            const end = offsetToPosition(lineStarts, i + 2);
            issues.push({
              ruleId: 'strict-equality',
              severity: 'warning',
              startLineNumber: start.lineNumber,
              startColumn: start.column,
              endLineNumber: end.lineNumber,
              endColumn: end.column,
              message: messages.strictEquality,
              fixText: '!==',
            });
            i += 1; // consume the '='
            continue;
          }
        }
        break;
      }
      case 'line-comment': {
        if (ch === '\n') state = 'code';
        break;
      }
      case 'block-comment': {
        if (ch === '*' && next === '/') {
          state = 'code';
          i += 1;
        }
        break;
      }
      case 'string': {
        if (ch === '\\') {
          i += 1; // skip the escaped char
          continue;
        }
        if (ch === stringQuote) {
          state = 'code';
          stringQuote = '';
        }
        break;
      }
    }
  }

  return issues;
}

/**
 * Cursor-anchored `add-semicolon` helper. Given a single physical line's text,
 * return the column (1-based, end of line) and fix when the line is a
 * statement that plausibly wants a trailing semicolon, else null.
 *
 * Deliberately CONSERVATIVE — only fires when the trimmed line ends in a token
 * that an expression statement ends with (identifier char, `)`, `]`, quote, or
 * a digit) and does NOT already end in a punctuation that forbids a semicolon
 * (`;`, `{`, `}`, `,`, `:`, `(`, `[`, `=>`, or a binary/assignment operator).
 * It is offered only at the cursor (no squiggle), so an occasional miss is
 * invisible and a false fire is impossible to apply by accident.
 */
export function suggestSemicolonFix(lineText: string): { column: number; fixText: ';' } | null {
  const withoutComment = stripTrailingLineComment(lineText);
  const trimmedEnd = withoutComment.replace(/\s+$/u, '');
  if (trimmedEnd.length === 0) return null;
  const last = trimmedEnd[trimmedEnd.length - 1]!;

  // Already terminated or in a context where a semicolon is wrong.
  if (';,:{([=&|<>+-*/%?.'.includes(last)) return null;
  if (last === '}') return null;
  // Line ending in a keyword/operator word (return\n, etc. is fine to end; but
  // `else`, `=>` handled by the punctuation guard). Accept identifier / ) / ]
  // / quote / digit as statement-ending.
  const endsLikeStatement = /[A-Za-z0-9_$)\]'"`]$/u.test(trimmedEnd);
  if (!endsLikeStatement) return null;

  // The fix is inserted at the end of the un-trimmed (but comment-stripped)
  // content so it lands before any trailing whitespace/comment.
  return { column: trimmedEnd.length + 1, fixText: ';' };
}

/**
 * Strip a trailing `//` line comment from a single line, respecting strings so
 * a `//` inside a string is not treated as a comment. Block comments are not
 * handled (rare on a single statement line); the semicolon helper is
 * best-effort and cursor-gated.
 */
function stripTrailingLineComment(lineText: string): string {
  let inString = false;
  let quote = '';
  for (let i = 0; i < lineText.length; i += 1) {
    const ch = lineText[i]!;
    if (inString) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === '/' && lineText[i + 1] === '/') {
      return lineText.slice(0, i);
    }
  }
  return lineText;
}

/**
 * RL-108 fold D — count the custom `'lingua-lint'` issues in a buffer without
 * needing a Monaco instance. Consumed today by the command palette to show the
 * active file's issue count on the "Toggle inline lint" command; a later
 * status-bar surface (RL-112) reads Monaco's own markers for the full
 * native + custom count. Returns 0 for non-JS/TS or clean buffers.
 */
export function countCustomLintIssues(content: string, language: string): number {
  return findLintIssues(content, language, { strictEquality: '' }).length;
}

/**
 * Build the replacement text for a `wrap-try-catch` refactor over the given
 * already-selected source lines, preserving the selection's base indentation.
 * Pure so the provider stays a thin adapter and the body is unit-tested.
 */
export function buildTryCatchWrap(selectedText: string, baseIndent: string): string {
  const inner = selectedText
    .split('\n')
    .map((line) => {
      if (line.length === 0) return line;
      const relativeLine = line.startsWith(baseIndent)
        ? line.slice(baseIndent.length)
        : line;
      return `${baseIndent}  ${relativeLine}`;
    })
    .join('\n');
  return `${baseIndent}try {\n${inner}\n${baseIndent}} catch (error) {\n${baseIndent}  console.error(error);\n${baseIndent}}`;
}
