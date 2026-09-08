/**
 * Magic-comment directive parsing, at two scopes.
 *
 *   - **Per-arrow** — the rich-output word on an arrow tail
 *     (`//=> table`), shared by the JS and the Python detector.
 *   - **Whole-buffer** — `@timeout`, `@origin off` and `@time`, each a
 *     pragma the runner reads once before a run starts.
 */

import { isJavaScriptFamily, isWorkerRunnerLanguage } from '../../../shared/languageFamilies';
import { walkTopLevelLines } from './jsLexer';
import type { MagicCommentDirective } from './types';

const KNOWN_DIRECTIVES: ReadonlySet<MagicCommentDirective> = new Set([
  'table',
  // implementation — chart / image / html become recognised
  // directive words. implementation (JS / TS) + implementation (Python) wire
  // the runner-side payload upgrade so the directive contract is now
  // fully live cross-language.
  'chart',
  'image',
  'html',
]);

// implementation-β-β-α implementation note — directive aliases. Maps user-facing
// shorthand to the canonical `MagicCommentDirective`. `figure` matches
// the matplotlib convention (`plt.show()` → "figure"); the runner
// receives the canonical name so the payload conversion stays single-
// path.
const DIRECTIVE_ALIASES: Readonly<Record<string, MagicCommentDirective>> = {
  figure: 'chart',
};

export function parseDirective(raw: string | undefined): MagicCommentDirective | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;
  if (KNOWN_DIRECTIVES.has(trimmed as MagicCommentDirective)) {
    return trimmed as MagicCommentDirective;
  }
  const alias = DIRECTIVE_ALIASES[trimmed];
  return alias ?? undefined;
}

/**
 * implementation note — `// @timeout 60s` (JS / TS) and `# @timeout
 * 60s` (Python). The first matching directive wins; later directives
 * are ignored so a forgotten copy-paste doesn't keep extending the
 * deadline silently.
 *
 * Accepted suffixes:
 *   - bare integer (`5`, `30`) → seconds
 *   - `s` / `sec` / `seconds` → seconds
 *   - `ms` / `millis` / `milliseconds` → milliseconds
 *   - `m` / `min` / `minutes` → minutes
 *
 * Returns null when no directive is present, when the value is
 * non-numeric, when the result would be ≤ 0 ms, or when the value
 * exceeds 600 s — the upper cap matches the `'extended'` preset.
 * Any caller-supplied `context.timeout` already overrides this, so
 * the override is strictly additive to the Settings preset.
 */
const TIMEOUT_DIRECTIVE_RE =
  /(?:\/\/|#)\s*@timeout\s+(\d+(?:\.\d+)?)\s*(ms|millis|milliseconds|s|sec|seconds|m|min|minutes)?\b/i;

export function extractTimeoutMagicComment(
  language: string,
  code: string
): number | null {
  // Limit to the JS / TS / Python comment dialects — other languages
  // have their own comment syntax and the directive is intentionally
  // narrow to the worker runners that consume it.
  if (!isWorkerRunnerLanguage(language)) return null;
  const match = code.match(TIMEOUT_DIRECTIVE_RE);
  if (!match) return null;
  const rawValue = match[1];
  const unit = (match[2] ?? 's').toLowerCase();
  if (!rawValue) return null;
  const value = parseFloat(rawValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  let ms: number;
  if (unit === 'ms' || unit === 'millis' || unit === 'milliseconds') {
    ms = value;
  } else if (unit === 'm' || unit === 'min' || unit === 'minutes') {
    ms = value * 60_000;
  } else {
    ms = value * 1_000;
  }
  if (ms <= 0) return null;
  // Cap at the extended preset ceiling so a runaway directive cannot
  // delay the kill timer beyond a sensible bound.
  const MAX_MS = 600_000;
  if (ms > MAX_MS) return MAX_MS;
  return Math.round(ms);
}

/**
 * implementation Sub-slice G implementation note — `// @origin off` (JS / TS) and
 * `# @origin off` (Python) per-tab directive that suppresses the
 * `<OutputLineBadge>` chip for sensitive logs. Users pasting tokens
 * or stack traces they don't want leaked through capsule export
 * drop this directive anywhere in the buffer and every subsequent
 * console row in the run skips its `origin` stamp.
 *
 * Matches both `// @origin off` and `// @origin: off` (loose colon
 * for ergonomic typing). Case-insensitive on the literal `off`.
 *
 * The detector is intentionally narrow — only `off` is accepted
 * because `on` is the default; widening the directive to
 * `@origin on` (re-enable mid-buffer) would require its own scope
 * and conflicts with the per-tab persistence model.
 */
// WARNING — implementation Sub-slice G.1 implementation note: this regex matches anywhere
// in the buffer, including INSIDE string literals. A line like
// `console.log("// @origin off")` will trip the directive and silently
// suppress the chip even though the user only wanted to log the
// directive text. We accept this false-positive because the privacy
// posture (over-suppress) is the safer side of the tradeoff. If a
// future work needs string-literal-aware detection, swap this for a
// tokenised scan (acorn / Babel AST) — the maintenance notes
// `[security] [ux] 2026-05-22` tracks the open question.
const ORIGIN_OFF_DIRECTIVE_RE =
  /(?:\/\/|#)\s*@origin\s*:?\s*off\b/i;

export function originSuppressedByMagicComment(
  language: string,
  code: string
): boolean {
  if (!isWorkerRunnerLanguage(language)) return false;
  if (typeof code !== 'string' || code.length === 0) return false;
  return ORIGIN_OFF_DIRECTIVE_RE.test(code);
}

/**
 * Whole-buffer pragma enabling per-statement timing for this run.
 * `\b` keeps `@timeout` (whose next char is a word char) from matching.
 * JS/TS only in implementation, hence the `//`-only comment opener.
 */
const TIME_DIRECTIVE_COMMENT_RE = /^\s*@time\b/iu;

/**
 * True when the buffer opts into per-line timing via `// @time`.
 * Presence in any real line comment enables it; string and regex literal
 * lookalikes stay inert because the shared lexical walker identifies the
 * actual comment opener.
 */
export function lineTimingRequestedByMagicComment(
  language: string,
  code: string
): boolean {
  if (!isJavaScriptFamily(language)) return false;
  let requested = false;
  walkTopLevelLines(code, ({ lineComment }) => {
    if (lineComment && TIME_DIRECTIVE_COMMENT_RE.test(lineComment)) {
      requested = true;
    }
  });
  return requested;
}
