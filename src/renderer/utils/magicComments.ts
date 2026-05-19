/**
 * Magic comment transformation for inline expression evaluation.
 *
 * Three variants:
 *
 *   - **Arrow `//=>` (JS / TS) and `#=>` (Python)** — ad-hoc inline
 *     peek; the line's prefix code IS the expression. The line gets
 *     replaced with a `__mc(line, value)` call.
 *
 *   - **`// @watch <expr>` (JS / TS) and `# @watch <expr>` (Python)** —
 *     RL-020 Slice 3. A *pinned* watch on an explicit expression. The
 *     line's prefix code is PRESERVED so the original statement still
 *     runs; the transform appends a `__mc(line, value)` call on the
 *     watched expression. Renderer tags the resulting `LineResult`
 *     with `type: 'watch'` (vs `'magic'` for arrows) so the panel can
 *     render a pin icon + sticky semantics.
 *
 *   - **Auto-log (RL-020 Slice 5, JS / TS only)** — opt-in
 *     whole-buffer pass. Every TOP-LEVEL bare expression statement
 *     is replaced with a `__mc(line, value)` capture so the expression
 *     executes once and its value surfaces inline without the user
 *     typing a `//=>`. The detector yields a sparse line list; the
 *     transform consumes it and emits `kind: 'autoLog'` in the side
 *     table the runner reads. Magic arrow / watch lines win over
 *     auto-log on the same line (the detector explicitly excludes
 *     them).
 *
 * All variants funnel through the same `__mc` runner injection — no
 * worker protocol change. The per-line `kind` lives in a side-table
 * the runner reads when stitching results back into `LineResult[]`.
 */

export type MagicCommentKind = 'arrow' | 'watch' | 'autoLog';

/**
 * RL-044 Slice 1A — rich-output directives surfaced on an arrow
 * magic comment. `'table'` is the only directive this slice ships;
 * `'chart'` / `'figure'` will land alongside the chart-renderer work
 * in Slice 2.
 *
 * Usage:
 *   `myArray //=> table` → renderer upgrades the inline pill from
 *   the stringified array to a `Table(N×M)` summary backed by a
 *   typed `RichOutputPayload` on the resulting `MagicCommentResult`.
 *
 * `undefined` means the arrow had no directive — legacy behavior.
 */
export type MagicCommentDirective = 'table';

export interface MagicCommentLine {
  /** 1-based line number in the original source */
  line: number;
  /** The expression text the runner should evaluate */
  expression: string;
  /**
   * RL-020 Slice 3 — which magic-comment syntactic variant produced
   * this entry. Arrow is the legacy `//=>` shape; watch is the new
   * `// @watch <expr>` pin.
   */
  kind: MagicCommentKind;
  /**
   * Line text that should still execute alongside the magic-comment
   * call. Empty for arrow lines (the prefix IS the expression);
   * non-empty for watch lines so a declaration like
   * `const x = 5; // @watch x` keeps `const x = 5;` running.
   */
  preserve: string;
  /**
   * RL-044 Slice 1A — optional rich-output directive parsed from
   * the comment tail (`//=> table`). The runner consumes this to
   * decide whether to upgrade the captured value to a typed
   * `RichOutputPayload`. Only set when `kind === 'arrow'` AND the
   * directive word is recognised; unknown directives silently
   * fall through to the legacy arrow path so a typo never breaks
   * a run.
   */
  directive?: MagicCommentDirective;
}

// ---------------------------------------------------------------------------
// JS / TS transform
// ---------------------------------------------------------------------------

const JS_WATCH_RE = /^(.*?)\/\/\s*@watch\s+(.+?)\s*$/;
// RL-044 Slice 1A — capture EVERYTHING after `=>` as the tail so we
// preserve the legacy `//=> free-form annotation` shape (the tail
// becomes a description, not a directive). The tail is then parsed
// by `parseDirective` which only returns a directive when the
// trimmed tail is exactly one of the recognised words — anything
// else falls through to the legacy arrow behaviour.
const JS_ARROW_RE = /^(.+?)\/\/\s*=>(.*)$/;

const KNOWN_DIRECTIVES: ReadonlySet<MagicCommentDirective> = new Set(['table']);

function parseDirective(raw: string | undefined): MagicCommentDirective | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;
  return KNOWN_DIRECTIVES.has(trimmed as MagicCommentDirective)
    ? (trimmed as MagicCommentDirective)
    : undefined;
}

function detectJSLine(line: string): MagicCommentLine | null {
  // RL-020 Slice 3 — watch wins over arrow when both shapes match.
  // The arrow regex is non-greedy and would otherwise consume a
  // pathological `// @watch x //=> y` line as an arrow result.
  const watchMatch = line.match(JS_WATCH_RE);
  if (watchMatch) {
    const expression = watchMatch[2]?.trim() ?? '';
    if (expression) {
      return {
        line: 0,
        expression,
        kind: 'watch',
        preserve: (watchMatch[1] ?? '').trimEnd(),
      };
    }
  }
  const arrowMatch = line.match(JS_ARROW_RE);
  if (arrowMatch?.[1]) {
    const expression = arrowMatch[1].trim();
    if (expression) {
      const directive = parseDirective(arrowMatch[2]);
      const base: MagicCommentLine = {
        line: 0,
        expression,
        kind: 'arrow',
        preserve: '',
      };
      return directive ? { ...base, directive } : base;
    }
  }
  return null;
}

/**
 * RL-020 Slice 7 fold B — `// @timeout 60s` (JS / TS) and `# @timeout
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
  const supports =
    language === 'javascript' ||
    language === 'typescript' ||
    language === 'python';
  if (!supports) return null;
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
 * Detect magic comment lines in JS/TS source code.
 */
export function detectJSMagicComments(code: string): MagicCommentLine[] {
  const results: MagicCommentLine[] = [];
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const detected = detectJSLine(lines[i]!);
    if (detected) {
      results.push({ ...detected, line: i + 1 });
    }
  }
  return results;
}

/**
 * Transform JS/TS code so that magic-comment expressions are captured.
 *
 * For each line matched by `detectJSLine`:
 *
 *   - **Arrow** — replace the line with a `__mc(line, value)` call
 *     wrapping the prefix expression (same as before Slice 3).
 *   - **Watch** — KEEP the prefix as-is and append `; __mc(line,
 *     value)` so the original statement still runs alongside the
 *     watch capture.
 */
export function transformJSMagicComments(code: string): string {
  const lines = code.split('\n');
  const transformed: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const detected = detectJSLine(line);
    if (!detected) {
      transformed.push(line);
      continue;
    }
    const lineNumber = i + 1;
    // Strip trailing semicolon from the expression so the function
    // body doesn't read as a statement.
    const cleanExpr = detected.expression.replace(/;$/, '');
    const mcCall = `__mc(${lineNumber}, (() => { try { return (${cleanExpr}); } catch(e) { return e instanceof Error ? e.message : String(e); } })())`;
    if (detected.kind === 'arrow') {
      transformed.push(`void (${mcCall});`);
    } else {
      // Watch — preserve the original line's prefix so declarations
      // (`const x = 5; // @watch x`) keep running. The trailing
      // semicolon makes the two halves syntactically independent.
      const prefix = detected.preserve;
      const needsSeparator = prefix.length > 0 && !/[;{}]\s*$/.test(prefix);
      const separator = needsSeparator ? ';' : '';
      transformed.push(`${prefix}${separator} void (${mcCall});`);
    }
  }

  return transformed.join('\n');
}

// ---------------------------------------------------------------------------
// RL-020 Slice 5 — JS / TS auto-log expression detector + transform
// ---------------------------------------------------------------------------

/**
 * Identifier-style starters that, when a line opens with them, signal
 * a statement that is NOT a bare expression: declarations, control
 * flow, exceptions, import/export, async control flow, etc. The
 * detector skips any such line and never wraps it in `__mc`.
 *
 * Notes:
 *   - `await` IS NOT here — `await fetch(...)` at top level is a
 *     valid bare expression and should auto-log.
 *   - `new` IS NOT here — `new Date()` evaluates to a value and is
 *     a legitimate bare expression worth surfacing.
 *   - `typeof`, `void`, `delete` are operator-prefixed expressions;
 *     they ARE bare expressions and should auto-log.
 *   - `yield` is meaningful inside generators but at top level it is
 *     a parse error; skip it conservatively.
 */
const AUTO_LOG_STATEMENT_KEYWORDS: ReadonlySet<string> = new Set([
  'const',
  'let',
  'var',
  'function',
  'class',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'default',
  'try',
  'catch',
  'finally',
  'return',
  'throw',
  'import',
  'export',
  'break',
  'continue',
  'with',
  'debugger',
  'yield',
  'interface',
  'type',
  'enum',
  'namespace',
  'declare',
  'module',
]);

const AUTO_LOG_REGEX_PREFIX_KEYWORDS: ReadonlySet<string> = new Set([
  'return',
  'throw',
  'case',
  'delete',
  'typeof',
  'void',
  'await',
  'yield',
]);

function lastSignificantTokenForAutoLog(line: string): string {
  let end = line.length;
  while (end > 0) {
    const code = line.charCodeAt(end - 1);
    if (code <= 32 || code === 160 || code === 0xfeff) {
      end--;
      continue;
    }
    break;
  }
  if (end === 0) return '';

  const last = line.charCodeAt(end - 1);
  if (isAsciiIdentifierPart(last)) {
    let start = end - 1;
    while (start > 0 && isAsciiIdentifierPart(line.charCodeAt(start - 1))) {
      start--;
    }
    return line.slice(start, end);
  }

  let start = end - 1;
  while (
    start > 0 &&
    end - start < 4 &&
    line.charCodeAt(start - 1) > 32 &&
    line.charCodeAt(start - 1) !== 160 &&
    line.charCodeAt(start - 1) !== 0xfeff &&
    !isAsciiIdentifierPart(line.charCodeAt(start - 1))
  ) {
    start--;
  }
  return line.slice(start, end);
}

function tokenCanPrecedeAutoLogRegexLiteral(token: string): boolean {
  if (token === '') return true;
  if (token === '(' || token === '[' || token === '{') return true;
  if (AUTO_LOG_REGEX_PREFIX_KEYWORDS.has(token)) return true;
  return AUTO_LOG_TRAILING_CONTINUATION_CHARS.includes(token[token.length - 1] ?? '');
}

function consumeAutoLogRegexLiteral(
  source: string,
  start: number
): { masked: string; nextIndex: number } {
  let i = start;
  let masked = '/';
  let inCharacterClass = false;
  i++;

  while (i < source.length) {
    const c = source[i] ?? '';
    const next = i + 1 < source.length ? source[i + 1] : '';

    if (c === '\n' || c === '\r') {
      masked += c;
      i++;
      return { masked, nextIndex: i };
    }

    if (c === '\\' && next !== '') {
      masked += '  ';
      i += 2;
      continue;
    }

    if (c === '[') {
      inCharacterClass = true;
      masked += ' ';
      i++;
      continue;
    }

    if (c === ']') {
      inCharacterClass = false;
      masked += ' ';
      i++;
      continue;
    }

    if (c === '/' && !inCharacterClass) {
      masked += '/';
      i++;
      while (i < source.length && isAsciiIdentifierPart(source.charCodeAt(i))) {
        masked += source[i] ?? '';
        i++;
      }
      return { masked, nextIndex: i };
    }

    masked += ' ';
    i++;
  }

  return { masked, nextIndex: i };
}

/**
 * Single-pass JS / TS scanner that records candidate auto-log lines.
 * Mirrors the shape of `scanSource` in `src/shared/autoRunGating.ts`
 * but finalizes each line during the scan so the hot path avoids
 * building full-source metadata arrays and re-splitting the buffer.
 */
function scanAutoLogCandidates(
  code: string,
  magicLines: ReadonlySet<number>
): number[] {
  let bracketDepth = 0; // ()
  let squareDepth = 0; // []
  let braceDepth = 0; // {}
  let inLineComment = false;
  let inBlockComment = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  const templateStack: boolean[] = [];
  const placeholderTargetDepth: number[] = [];

  const out: number[] = [];
  const hasMagicLines = magicLines.size > 0;
  let strippedLine = '';
  let lineNumber = 1;
  let lineStart = 0;
  let depthAtLineStart = 0;

  const totalDepth = () =>
    bracketDepth + squareDepth + braceDepth + templateStack.length;

  const isInsideOpenToken = () =>
    inBlockComment ||
    inSingleQuote ||
    inDoubleQuote ||
    (templateStack.length > 0 &&
      templateStack[templateStack.length - 1] === true);

  const finishLine = (lineEnd: number) => {
    const depthAtLineEnd = totalDepth();
    if (
      (!hasMagicLines || !magicLines.has(lineNumber)) &&
      isAutoLogCandidateLine(
        strippedLine,
        code,
        lineStart,
        lineEnd,
        depthAtLineStart,
        depthAtLineEnd,
        isInsideOpenToken()
      )
    ) {
      out.push(lineNumber);
    }
    lineNumber++;
    lineStart = lineEnd + 1;
    depthAtLineStart = depthAtLineEnd;
    strippedLine = '';
  };

  let i = 0;
  const len = code.length;

  while (i < len) {
    const c = code[i];
    const next = i + 1 < len ? code[i + 1] : '';

    if (c === '\n') {
      finishLine(i);
      inLineComment = false;
      i++;
      continue;
    }

    if (inLineComment) {
      strippedLine += ' ';
      i++;
      continue;
    }

    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        strippedLine += '  ';
        i += 2;
      } else {
        strippedLine += ' ';
        i++;
      }
      continue;
    }

    if (inSingleQuote) {
      if (c === '\\' && next !== '') {
        strippedLine += '  ';
        i += 2;
        continue;
      }
      if (c === "'") {
        inSingleQuote = false;
        strippedLine += c;
      } else {
        strippedLine += ' ';
      }
      i++;
      continue;
    }

    if (inDoubleQuote) {
      if (c === '\\' && next !== '') {
        strippedLine += '  ';
        i += 2;
        continue;
      }
      if (c === '"') {
        inDoubleQuote = false;
        strippedLine += c;
      } else {
        strippedLine += ' ';
      }
      i++;
      continue;
    }

    if (templateStack.length > 0 && templateStack[templateStack.length - 1]) {
      if (c === '\\' && next !== '') {
        strippedLine += '  ';
        i += 2;
        continue;
      }
      if (c === '`') {
        templateStack.pop();
        strippedLine += c;
        i++;
        continue;
      }
      if (c === '$' && next === '{') {
        templateStack[templateStack.length - 1] = false;
        braceDepth++;
        placeholderTargetDepth.push(braceDepth);
        strippedLine += '${';
        i += 2;
        continue;
      }
      strippedLine += ' ';
      i++;
      continue;
    }

    // JS context (top-level OR template placeholder).
    if (c === '/' && next === '/') {
      inLineComment = true;
      strippedLine += '  ';
      i += 2;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      strippedLine += '  ';
      i += 2;
      continue;
    }
    if (
      c === '/' &&
      tokenCanPrecedeAutoLogRegexLiteral(lastSignificantTokenForAutoLog(strippedLine))
    ) {
      const regex = consumeAutoLogRegexLiteral(code, i);
      strippedLine += regex.masked;
      i = regex.nextIndex;
      continue;
    }
    if (c === "'") {
      inSingleQuote = true;
      strippedLine += c;
      i++;
      continue;
    }
    if (c === '"') {
      inDoubleQuote = true;
      strippedLine += c;
      i++;
      continue;
    }
    if (c === '`') {
      templateStack.push(true);
      strippedLine += c;
      i++;
      continue;
    }
    if (c === '(') {
      bracketDepth++;
      strippedLine += c;
      i++;
      continue;
    }
    if (c === ')') {
      bracketDepth--;
      strippedLine += c;
      i++;
      continue;
    }
    if (c === '[') {
      squareDepth++;
      strippedLine += c;
      i++;
      continue;
    }
    if (c === ']') {
      squareDepth--;
      strippedLine += c;
      i++;
      continue;
    }
    if (c === '{') {
      braceDepth++;
      strippedLine += c;
      i++;
      continue;
    }
    if (c === '}') {
      braceDepth--;
      if (
        templateStack.length > 0 &&
        templateStack[templateStack.length - 1] === false &&
        placeholderTargetDepth.length > 0 &&
        braceDepth ===
          (placeholderTargetDepth[placeholderTargetDepth.length - 1] ?? 0) - 1
      ) {
        templateStack[templateStack.length - 1] = true;
        placeholderTargetDepth.pop();
      }
      strippedLine += c;
      i++;
      continue;
    }
    strippedLine += c;
    i++;
  }

  // Close out the final (no trailing newline) line.
  finishLine(len);

  return out;
}

const AUTO_LOG_TRAILING_CONTINUATION_CHARS = '([{,.+-*/%=&|^?:<>!';
const EMPTY_MAGIC_LINES: ReadonlySet<number> = new Set<number>();

function trimLine(line: string): string {
  return line.trim();
}

function stripTrailingSemicolons(line: string): string {
  let end = line.length;
  while (end > 0) {
    const code = line.charCodeAt(end - 1);
    if (line[end - 1] === ';' || code <= 32 || code === 160 || code === 0xfeff) {
      end--;
      continue;
    }
    break;
  }
  return end === line.length ? line : line.slice(0, end);
}

function isAsciiIdentifierStart(code: number): boolean {
  return (
    code === 36 ||
    code === 95 ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function isAsciiIdentifierPart(code: number): boolean {
  return (
    isAsciiIdentifierStart(code) ||
    (code >= 48 && code <= 57)
  );
}

function startsWithKeyword(value: string, keyword: string): boolean {
  if (!value.startsWith(keyword)) return false;
  const next = value.charCodeAt(keyword.length);
  return Number.isNaN(next) || !isAsciiIdentifierPart(next);
}

function endsWithTrailingContinuation(line: string): boolean {
  return AUTO_LOG_TRAILING_CONTINUATION_CHARS.includes(line[line.length - 1] ?? '');
}

function startsWithJsxTag(source: string, start: number, end: number): boolean {
  let i = start;
  while (i < end) {
    const code = source.charCodeAt(i);
    if (code > 32 && code !== 160 && code !== 0xfeff) break;
    i++;
  }
  if (i >= end || source.charCodeAt(i) !== 60) return false;
  const second = source.charCodeAt(i + 1);
  return (
    second === 47 ||
    (second >= 65 && second <= 90) ||
    (second >= 97 && second <= 122)
  );
}

function startsWithStatementKeyword(line: string): boolean {
  if (line.length === 0) return true;
  // Identifier-style first token. Match `[A-Za-z_$][A-Za-z0-9_$]*` so
  // we don't accidentally match `0xff` as a keyword.
  const first = line.charCodeAt(0);
  if (!isAsciiIdentifierStart(first)) return false;
  let end = 1;
  while (end < line.length && isAsciiIdentifierPart(line.charCodeAt(end))) {
    end++;
  }
  const head = line.slice(0, end);
  if (AUTO_LOG_STATEMENT_KEYWORDS.has(head)) return true;
  // `async function …` and `async class …` are declarations; an
  // `async (x) => …` remains a valid expression and can be
  // auto-logged. Without this guard, `async function f() { return
  // 1; }` on a single line at top level would be wrapped in
  // `__mc(…, async function f() { … })` — valid JS, but the wrapped
  // value (the function declaration statement's effective value is
  // `undefined`) is misleading exploration UX. We bias toward the
  // declaration false-negative.
  if (head === 'async') {
    const afterAsync = line.slice(end).trimStart();
    if (startsWithKeyword(afterAsync, 'function') || startsWithKeyword(afterAsync, 'class')) {
      return true;
    }
  }
  // Labelled statements like `loop: for (...)` look like an
  // identifier followed by `:`; skip the label itself rather than
  // wrapping a phantom expression in `__mc`.
  const afterIdent = line.slice(end).trimStart();
  if (afterIdent.startsWith(':') && !afterIdent.startsWith('::')) return true;
  return false;
}

/**
 * Heuristic: does this line look like a top-level bare expression
 * statement that's safe to wrap in `__mc(line, value)`?
 *
 *   - Must start the line at bracket depth 0 AND end at bracket
 *     depth 0 (single-line expression).
 *   - Must not be inside an open string / template / block comment.
 *   - Must not start with a statement keyword (declarations,
 *     control flow, etc.).
 *   - Must not be empty / whitespace / comment-only.
 *   - Must not end with a continuation token (`,`, `+`, `?`, ...)
 *     or a block opener `{` — those are line-continuations.
 *   - Must not contain JSX (a `<` followed by a capital identifier
 *     character or `/` opens a fragment / element on a JS scanner
 *     that doesn't reason about JSX).
 *   - Must not already be a magic-comment line (the caller passes
 *     the set of magic-comment line numbers and we skip them).
 */
function isAutoLogCandidateLine(
  strippedLine: string,
  source: string,
  originalStart: number,
  originalEnd: number,
  depthAtStart: number,
  depthAtEnd: number,
  insideToken: boolean
): boolean {
  if (depthAtStart !== 0) return false;
  if (depthAtEnd !== 0) return false;
  if (insideToken) return false;

  const trimmedStripped = trimLine(strippedLine);
  if (trimmedStripped.length === 0) return false;
  if (startsWithStatementKeyword(trimmedStripped)) return false;

  // Drop the trailing `;` so we can ask "what is the final
  // significant character?" without `;` shadowing real continuations.
  const withoutSemicolon = stripTrailingSemicolons(trimmedStripped);
  if (withoutSemicolon.length === 0) return false;

  // Continuation indicators on the comment-stripped tail.
  if (endsWithTrailingContinuation(withoutSemicolon)) return false;

  // JSX guard — `<Foo>`, `<Foo />`, `</Foo>` look like comparison /
  // shift to a non-JSX scanner. If the stripped tail or head looks
  // like it opens or closes a JSX tag, bail.
  if (startsWithJsxTag(source, originalStart, originalEnd)) return false;

  return true;
}

/**
 * Detect 1-based line numbers in a JS / TS buffer that are
 * candidates for the auto-log transform.
 *
 * @param code Source code being analysed.
 * @param magicLines 1-based line numbers already claimed by a `//=>`
 *   or `// @watch` magic-comment. The detector excludes them so
 *   auto-log never double-wraps the same line — arrow / watch keep
 *   their explicit precedence.
 */
export function detectJSAutoLogLines(
  code: string,
  magicLines: ReadonlySet<number> = EMPTY_MAGIC_LINES
): number[] {
  if (code.length === 0) return [];
  return scanAutoLogCandidates(code, magicLines);
}

/**
 * Split a trailing `//` comment from a single auto-log candidate
 * line without treating `//` inside strings or template text as a
 * comment opener. The expression transform uses this so the capture
 * code is inserted before the comment instead of being swallowed by
 * it.
 */
function splitTrailingLineComment(line: string): {
  code: string;
  comment: string;
} {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  let inBlockComment = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const next = i + 1 < line.length ? line[i + 1] : '';

    if (inSingleQuote || inDoubleQuote || inTemplate) {
      if (c === '\\' && next !== '') {
        i++;
        continue;
      }
      if (inSingleQuote && c === "'") {
        inSingleQuote = false;
      } else if (inDoubleQuote && c === '"') {
        inDoubleQuote = false;
      } else if (inTemplate && c === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (c === "'") {
      inSingleQuote = true;
      continue;
    }
    if (c === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (c === '`') {
      inTemplate = true;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (c === '/' && next === '/') {
      return {
        code: line.slice(0, i).trimEnd(),
        comment: line.slice(i).trimStart(),
      };
    }
  }

  return { code: line.trimEnd(), comment: '' };
}

function buildAutoLogCapture(
  lineNumber: number,
  expression: string
): string {
  return `__mc(${lineNumber}, await (async () => { try { return (${expression}); } catch(__e) { return __e instanceof Error ? __e.message : String(__e); } })())`;
}

/**
 * Transform a JS / TS buffer by replacing every line listed in
 * `autoLogLines` with a single `__mc(line, value)` capture. The
 * expression executes once; indentation and trailing line comments
 * are preserved for readability.
 *
 * Call this AFTER `transformJSMagicComments` so magic-comment lines
 * (which `detectJSAutoLogLines` already excludes) keep their
 * specialised transform shape.
 */
export function transformJSAutoLog(
  code: string,
  autoLogLines: ReadonlyArray<number>
): string {
  if (autoLogLines.length === 0) return code;
  const targets = new Set<number>(autoLogLines);
  const lines = code.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const original = lines[i]!;
    const lineNumber = i + 1;
    if (!targets.has(lineNumber)) {
      out.push(original);
      continue;
    }
    const { code: codeBeforeComment, comment } = original.includes('//')
      ? splitTrailingLineComment(original)
      : { code: original, comment: '' };
    const trimmed = stripTrailingSemicolons(trimLine(codeBeforeComment));
    if (trimmed.length === 0) {
      out.push(original);
      continue;
    }
    const indentMatch = original.match(/^(\s*)/u);
    const indent = indentMatch?.[1] ?? '';
    const mcCall = buildAutoLogCapture(lineNumber, trimmed);
    const suffix = comment ? ` ${comment}` : '';
    out.push(`${indent}void (${mcCall});${suffix}`);
  }

  return out.join('\n');
}

const PY_WATCH_RE = /^(.*?)#\s*@watch\s+(.+?)\s*$/;
// RL-044 Slice 1A — same shape as the JS arrow regex: capture the
// full tail and let `parseDirective` decide whether it's a known
// directive or a legacy free-form comment.
const PY_ARROW_RE = /^(.+?)#\s*=>(.*)$/;

function detectPythonLine(line: string): MagicCommentLine | null {
  const watchMatch = line.match(PY_WATCH_RE);
  if (watchMatch) {
    const expression = watchMatch[2]?.trim() ?? '';
    const preserve = (watchMatch[1] ?? '').trimEnd();
    // Reject watches on control-flow header lines (`if`, `for`,
    // `with`, `try`, `class`, `def` etc. — anything ending with
    // `:`). Appending `; __mc(...)` after the colon would eat the
    // indented body in the transform pass, silently breaking the
    // program. Return null so the line stays a plain comment.
    if (expression && !preserve.trimEnd().endsWith(':')) {
      return {
        line: 0,
        expression,
        kind: 'watch',
        preserve,
      };
    }
  }
  const arrowMatch = line.match(PY_ARROW_RE);
  if (arrowMatch?.[1]) {
    const expression = arrowMatch[1].trim();
    if (expression) {
      const directive = parseDirective(arrowMatch[2]);
      const base: MagicCommentLine = {
        line: 0,
        expression,
        kind: 'arrow',
        preserve: '',
      };
      return directive ? { ...base, directive } : base;
    }
  }
  return null;
}

/**
 * Detect magic comment lines in Python source code.
 */
export function detectPythonMagicComments(code: string): MagicCommentLine[] {
  const results: MagicCommentLine[] = [];
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const detected = detectPythonLine(lines[i]!);
    if (detected) {
      results.push({ ...detected, line: i + 1 });
    }
  }
  return results;
}

/**
 * Transform Python code so that magic-comment expressions are captured.
 *
 * For arrow lines the line is replaced wholesale (same as before
 * Slice 3). For watch lines, the prefix statement is kept and the
 * watch `__mc` call is appended after a `;` separator — Python allows
 * `a = 5; expr` on a single logical line so the declaration still
 * runs.
 */
export function transformPythonMagicComments(code: string): string {
  const lines = code.split('\n');
  const transformed: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const detected = detectPythonLine(line);
    if (!detected) {
      transformed.push(line);
      continue;
    }
    const lineNumber = i + 1;
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch?.[1] ?? '';
    // RL-044 Slice 1C fold D — forward the parsed directive (currently
    // only `'table'`) into the `__mc` runner so the Python worker can
    // attach a forced-table payload alongside the legacy value text.
    // Unknown / missing directives stay None on the Python side.
    const directiveArg = detected.directive
      ? `, directive=${JSON.stringify(detected.directive)}`
      : '';
    const mcCall = `__mc(${lineNumber}, lambda: (${detected.expression})${directiveArg})`;
    if (detected.kind === 'arrow') {
      transformed.push(`${indent}${mcCall}`);
    } else {
      const prefix = detected.preserve;
      if (prefix.length === 0) {
        transformed.push(`${indent}${mcCall}`);
      } else {
        // Python: keep the indentation of the prefix so runtime
        // semantics (try/except blocks, function bodies, etc.) stay
        // intact. The watched line gets emitted at the same level.
        const trimmedPrefix = prefix.trimStart();
        const sep = /[;:]\s*$/.test(trimmedPrefix) ? '' : ';';
        transformed.push(`${indent}${trimmedPrefix}${sep} ${mcCall}`);
      }
    }
  }

  return transformed.join('\n');
}

/**
 * RL-020 Slice 5 — runner-side option bag. Auto-log is opt-in and
 * JS / TS only. Python is excluded by construction (the option is
 * silently ignored for Python).
 */
export interface MagicCommentTransformOptions {
  /**
   * Replace every top-level bare expression statement with an
   * `__mc(line, value)` capture, in addition to any explicit `//=>`
   * arrows and `// @watch` watches. JS / TS only.
   */
  autoLog?: boolean;
}

/**
 * RL-020 Slice 3 — derive the per-line `kind` map for a given source.
 * Runners use this side-table at result-stitching time to tag each
 * incoming `magic-comment` worker message with `'arrow'` /
 * `'watch'` / `'autoLog'` (the worker postMessage protocol is
 * intentionally kind-agnostic).
 *
 * Returns a sparse `Record<lineNumber, MagicCommentKind>`; lookup
 * defaults to `'arrow'` for any unrecognized line — the worker would
 * not have emitted a message for that line in the first place, so
 * the fallback is purely defensive.
 *
 * RL-020 Slice 5 — when `options.autoLog` is true and the language
 * is JS / TS, any line that the auto-log detector flags AND that is
 * not already claimed by an arrow / watch gets `kind: 'autoLog'` in
 * the returned map. Arrow + watch win over auto-log on the same
 * line because `detectJSAutoLogLines` consumes a magic-line skip
 * set.
 */
export function magicCommentKindsByLine(
  language: 'javascript' | 'typescript' | 'python',
  code: string,
  options: MagicCommentTransformOptions = {}
): Record<number, MagicCommentKind> {
  const detected =
    language === 'python'
      ? detectPythonMagicComments(code)
      : detectJSMagicComments(code);
  const map: Record<number, MagicCommentKind> = {};
  for (const entry of detected) {
    map[entry.line] = entry.kind;
  }
  if (options.autoLog && language !== 'python') {
    const magicLines = new Set<number>(detected.map((entry) => entry.line));
    for (const line of detectJSAutoLogLines(code, magicLines)) {
      // Arrow / watch already in the map — `detectJSAutoLogLines`
      // received `magicLines` and would not yield those lines. The
      // explicit guard below makes the precedence reviewable.
      if (!(line in map)) {
        map[line] = 'autoLog';
      }
    }
  }
  return map;
}
