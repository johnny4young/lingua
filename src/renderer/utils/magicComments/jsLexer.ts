/**
 * The hand-rolled JS / TS line scanner shared by auto-log, per-line
 * timing and the `@time` pragma probe.
 *
 * One pass tracks bracket depth, strings, templates (with `${}` nesting),
 * regex literals and comments, so every consumer sees the same structural
 * facts and the tokenizer quirks live in exactly one place. Replacing it
 * with a real parser (acorn) is a separate spike, not a refactor.
 *
 * Exports below the detector are internal to the `magicComments/` folder
 * and deliberately absent from `index.ts`.
 */

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
/**
 * Per-line facts the shared top-level scanner hands each consumer.
 * `stripped` masks string/template/comment interiors with spaces so
 * structural checks never trip on user text.
 */
export interface TopLevelLineInfo {
  /** 1-based line number. */
  lineNumber: number;
  /** The comment/string-masked line content. */
  stripped: string;
  /** Absolute offset of the line's first character. */
  lineStart: number;
  /** Absolute offset of the line's terminator (or EOF). */
  lineEnd: number;
  /** Combined bracket+template depth when the line begins. */
  depthAtStart: number;
  /** Combined bracket+template depth when the line ends. */
  depthAtEnd: number;
  /** True when the line BEGINS inside a string/template/block comment. */
  openTokenAtStart: boolean;
  /** True when the line ENDS inside a string/template/block comment. */
  openTokenAtEnd: boolean;
  /** Text after a real JS `//` opener, excluding string/regex literals. */
  lineComment: string | null;
}

/**
 * Shared JS/TS line walker: one pass over the buffer tracking bracket
 * depth, strings, templates (with `${}` nesting), and comments, calling
 * `onLine` with the structural facts for every physical line. Both the
 * auto-log detector  and the internal statement-start
 * detector consume it, so the tokenizer quirks live in exactly one
 * place.
 */
export function walkTopLevelLines(
  code: string,
  onLine: (info: TopLevelLineInfo) => void
): void {
  let bracketDepth = 0; // ()
  let squareDepth = 0; // []
  let braceDepth = 0; // {}
  let inLineComment = false;
  let inBlockComment = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  const templateStack: boolean[] = [];
  const placeholderTargetDepth: number[] = [];

  let strippedLine = '';
  let lineNumber = 1;
  let lineStart = 0;
  let depthAtLineStart = 0;
  let openTokenAtLineStart = false;
  let lineComment: string | null = null;

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
    const openTokenAtLineEnd = isInsideOpenToken();
    onLine({
      lineNumber,
      stripped: strippedLine,
      lineStart,
      lineEnd,
      depthAtStart: depthAtLineStart,
      depthAtEnd: depthAtLineEnd,
      openTokenAtStart: openTokenAtLineStart,
      openTokenAtEnd: openTokenAtLineEnd,
      lineComment,
    });
    lineNumber++;
    lineStart = lineEnd + 1;
    depthAtLineStart = depthAtLineEnd;
    openTokenAtLineStart = openTokenAtLineEnd;
    strippedLine = '';
    lineComment = null;
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
      const newline = code.indexOf('\n', i + 2);
      lineComment = code.slice(i + 2, newline === -1 ? len : newline);
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
}

export function scanAutoLogCandidates(
  code: string,
  magicLines: ReadonlySet<number>
): number[] {
  const out: number[] = [];
  const hasMagicLines = magicLines.size > 0;
  walkTopLevelLines(code, (info) => {
    if (
      (!hasMagicLines || !magicLines.has(info.lineNumber)) &&
      isAutoLogCandidateLine(
        info.stripped,
        code,
        info.lineStart,
        info.lineEnd,
        info.depthAtStart,
        info.depthAtEnd,
        info.openTokenAtEnd
      )
    ) {
      out.push(info.lineNumber);
    }
  });
  return out;
}

const AUTO_LOG_TRAILING_CONTINUATION_CHARS = '([{,.+-*/%=&|^?:<>!';
export const EMPTY_MAGIC_LINES: ReadonlySet<number> = new Set<number>();

export function trimLine(line: string): string {
  return line.trim();
}

export function stripTrailingSemicolons(line: string): string {
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

export function endsWithTrailingContinuation(line: string): boolean {
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
