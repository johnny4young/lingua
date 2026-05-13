/**
 * RL-020 Slice 1 — Auto-run completion gate.
 *
 * Renderer hooks call `isLikelyComplete(language, code)` before
 * dispatching an auto-run. If `ready === false`, the hook short-
 * circuits: no runner spawn, no iframe srcdoc reassignment, no
 * console pollution from transient `SyntaxError: Unexpected end of
 * input` lines fired every 1.2s while the user is still mid-edit.
 *
 * Posture:
 *
 *   - Pure module. No DOM, no Monaco, no `import 'monaco-editor'`.
 *     Vitest-safe under the `node` environment so the bench fixture
 *     can hammer it in a tight loop.
 *   - Heuristic, not parser-precise. The gate's job is to skip the
 *     obvious incomplete shapes (open brackets, trailing keywords,
 *     trailing operators) — not to be a full JS parser. False
 *     positives are tolerable; false negatives (gating valid code)
 *     are the real risk and the test suite pins them.
 *   - JS / TS only this slice. Other languages return `ready: true`
 *     so existing auto-run flows (Python validate, Go validate,
 *     etc.) stay untouched.
 *   - Comments stripped before the trailing-token sweep so a
 *     `// TODO`-suffix line never reads as incomplete.
 *
 * Bracket / quote scanning walks the source once, character by
 * character, tracking whether we're inside a single-line comment, a
 * block comment, a single-quoted string, a double-quoted string, or
 * a template literal (with `${ … }` re-entering the JS context).
 * That single pass is what powers both the bracket-balance check and
 * the trailing-token sweep (the trailing token is the last non-
 * comment, non-whitespace token by source order).
 */

export type AutoRunGateReason = 'empty' | 'incomplete' | 'ok';

export interface AutoRunGateResult {
  ready: boolean;
  reason: AutoRunGateReason;
}

/**
 * The shape of a `Language` value we care about. Stays string-typed
 * so this module never depends on the renderer's `LANGUAGE_PACKS`
 * registry — keeps the bundle clean for tests + the future
 * standalone bench fixture.
 */
type GatedLanguage = 'javascript' | 'typescript';

function isGatedLanguage(language: string): language is GatedLanguage {
  return language === 'javascript' || language === 'typescript';
}

/**
 * Tokens that, if the LAST non-whitespace, non-comment token on the
 * buffer, almost certainly mean the user is still typing. Trailing
 * operators (`+`, `=`, `&&`, ...) and trailing keywords (`const`,
 * `function`, `=>`, ...). A trailing `;` or `}` or identifier reads
 * as complete; the gate clears.
 */
const TRAILING_INCOMPLETE_OPERATORS = new Set([
  '+',
  '-',
  '*',
  '/',
  '=',
  ',',
  '.',
  '?',
  ':',
  '&&',
  '||',
  '??',
  '==',
  '===',
  '!=',
  '!==',
  '<',
  '>',
  '<=',
  '>=',
  '%',
  '**',
  '&',
  '|',
  '^',
  '<<',
  '>>',
  '>>>',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '**=',
  '&=',
  '|=',
  '^=',
  '<<=',
  '>>=',
  '>>>=',
  '&&=',
  '||=',
  '??=',
  '=>',
]);

const TRAILING_INCOMPLETE_KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'try',
  'catch',
  'finally',
  'async',
  'await',
  'typeof',
  'new',
  'throw',
  'import',
  'export',
  'from',
  'as',
  'in',
  'of',
  'instanceof',
]);

interface StripResult {
  /** Source with comments collapsed to spaces (preserves offsets). */
  stripped: string;
  /** Final unbalanced-state of any structural scan. */
  unbalanced: boolean;
  /** True if any open `${` is still waiting for its closing `}`. */
  openTemplatePlaceholder: boolean;
  /** True if any open quote is still hanging. */
  openQuote: boolean;
  /** True if a block comment is still open. */
  openBlockComment: boolean;
}

/**
 * Single-pass scanner: collapse comments and raw string/template
 * text to spaces, count bracket depth, track unterminated string /
 * template / comment states. Delimiters stay in place, but content
 * is masked so the auto-pair sweep never treats a `)` inside a
 * string as a JavaScript close-paren.
 */
function scanSource(source: string): StripResult {
  let bracketDepth = 0; // ()
  let squareDepth = 0; // []
  let braceDepth = 0; // {}
  let inLineComment = false;
  let inBlockComment = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let unterminatedQuote = false;
  // Template literal context. `templateStack[i] = true` while the
  // outer template is in raw mode (between `${`s); a `${` push flips
  // to JS mode (false) until the matching `}` pops back.
  const templateStack: boolean[] = [];
  // RL-020 Slice 1 — per-placeholder snapshot of `braceDepth` at the
  // moment `${` opens its JS context. Pop back to raw template only
  // when a `}` returns the counter to this saved value; otherwise
  // the `}` closes a NESTED object literal / destructuring / arrow
  // body inside the placeholder. Without this, `` `${{ a: 1 }}` ``
  // would prematurely flip out of placeholder context on the first
  // inner `}` and leave `braceDepth` unbalanced.
  const placeholderTargetDepth: number[] = [];
  let i = 0;
  const len = source.length;
  // Output buffer: copy chars 1:1, except inside comments where we
  // emit a space so the offset survives but the trailing-token sweep
  // skips it naturally.
  let out = '';

  while (i < len) {
    const c = source[i];
    const next = i + 1 < len ? source[i + 1] : '';

    if (inLineComment) {
      if (c === '\n') {
        inLineComment = false;
        out += '\n';
      } else {
        out += ' ';
      }
      i++;
      continue;
    }

    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        out += '  ';
        i += 2;
      } else {
        out += c === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }

    if (inSingleQuote) {
      if (c === '\\' && next !== '') {
        out += '  ';
        i += 2;
        continue;
      }
      if (c === '\n') {
        // Unterminated single-quoted string — heuristic still tracks
        // as "open quote"; emit as-is and bail of the string ctx so
        // the rest of the buffer is not all marked as string.
        unterminatedQuote = true;
        inSingleQuote = false;
        out += c;
        i++;
        continue;
      }
      if (c === "'") {
        inSingleQuote = false;
        out += c;
      } else {
        out += ' ';
      }
      i++;
      continue;
    }

    if (inDoubleQuote) {
      if (c === '\\' && next !== '') {
        out += '  ';
        i += 2;
        continue;
      }
      if (c === '\n') {
        unterminatedQuote = true;
        inDoubleQuote = false;
        out += c;
        i++;
        continue;
      }
      if (c === '"') {
        inDoubleQuote = false;
        out += c;
      } else {
        out += ' ';
      }
      i++;
      continue;
    }

    // Template-literal raw context: inside the back-ticked body.
    if (templateStack.length > 0 && templateStack[templateStack.length - 1]) {
      if (c === '\\' && next !== '') {
        out += '  ';
        i += 2;
        continue;
      }
      if (c === '`') {
        templateStack.pop();
        out += c;
        i++;
        continue;
      }
      if (c === '$' && next === '{') {
        // Enter JS context inside the placeholder.
        templateStack[templateStack.length - 1] = false;
        // Track the placeholder's brace as an OPEN that the JS
        // scanner already counts via `braceDepth`. Record the depth
        // ABOVE which we are in placeholder-JS; popping back to that
        // depth means we hit the placeholder's closing `}`.
        braceDepth++;
        placeholderTargetDepth.push(braceDepth);
        out += '${';
        i += 2;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    // JS context (top-level OR template placeholder).
    if (c === '/' && next === '/') {
      inLineComment = true;
      out += '  ';
      i += 2;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      out += '  ';
      i += 2;
      continue;
    }
    if (c === "'") {
      inSingleQuote = true;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inDoubleQuote = true;
      out += c;
      i++;
      continue;
    }
    if (c === '`') {
      templateStack.push(true);
      out += c;
      i++;
      continue;
    }
    if (c === '(') {
      bracketDepth++;
      out += c;
      i++;
      continue;
    }
    if (c === ')') {
      bracketDepth--;
      out += c;
      i++;
      continue;
    }
    if (c === '[') {
      squareDepth++;
      out += c;
      i++;
      continue;
    }
    if (c === ']') {
      squareDepth--;
      out += c;
      i++;
      continue;
    }
    if (c === '{') {
      braceDepth++;
      out += c;
      i++;
      continue;
    }
    if (c === '}') {
      braceDepth--;
      // Template-placeholder close: pop back to raw template ctx
      // ONLY when this `}` lands at the depth the placeholder
      // originally opened from. Inner `}` (object literals,
      // destructuring patterns, arrow function bodies) leave the
      // template context untouched.
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
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }

  const unbalanced =
    bracketDepth !== 0 ||
    squareDepth !== 0 ||
    braceDepth !== 0 ||
    templateStack.length !== 0;

  const openTemplatePlaceholder = templateStack.some((isRaw) => !isRaw);
  const openQuote = inSingleQuote || inDoubleQuote || unterminatedQuote;
  const openBlockComment = inBlockComment;

  return {
    stripped: out,
    unbalanced,
    openTemplatePlaceholder,
    openQuote,
    openBlockComment,
  };
}

function isWhitespaceChar(char: string): boolean {
  return (
    char === ' ' ||
    char === '\n' ||
    char === '\r' ||
    char === '\t' ||
    char === '\v' ||
    char === '\f'
  );
}

function isIdentifierChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    char === '_' ||
    char === '$'
  );
}

/**
 * Pull the last non-whitespace token from a comment-stripped string.
 * Words match `[A-Za-z_$][A-Za-z0-9_$]*`; operators match a sticky
 * suffix scan (`=>`, `&&`, `||`, `===`, ...). Returns the empty
 * string when the buffer is whitespace-only.
 */
function lastSignificantTokenBefore(stripped: string, endExclusive: number): string {
  // Trim trailing whitespace.
  let end = Math.min(stripped.length, Math.max(0, endExclusive));
  while (end > 0 && isWhitespaceChar(stripped[end - 1] ?? '')) end--;
  if (end === 0) return '';

  const last = stripped[end - 1] ?? '';
  // Identifier-style token.
  if (isIdentifierChar(last)) {
    let start = end - 1;
    while (start > 0 && isIdentifierChar(stripped[start - 1] ?? '')) {
      start--;
    }
    return stripped.slice(start, end);
  }
  // Operator-style token: walk backward over non-word, non-space
  // characters (cap at 4 chars — longest we care about is `>>>=`).
  let start = end - 1;
  while (
    start > 0 &&
    end - start < 4 &&
    !isWhitespaceChar(stripped[start - 1] ?? '') &&
    !isIdentifierChar(stripped[start - 1] ?? '')
  ) {
    start--;
  }
  return stripped.slice(start, end);
}

function lastSignificantToken(stripped: string): string {
  return lastSignificantTokenBefore(stripped, stripped.length);
}

/**
 * Auto-pair-aware sweep. Monaco (and every modern code editor)
 * automatically inserts a matching close-bracket when the user types
 * an open-bracket — so a buffer the user perceives as `for (let i = `
 * actually reads as `for (let i = )` with balanced brackets. The
 * heuristic above would clear the gate because the last token is `)`.
 *
 * This walk catches the auto-pair case: at every close-bracket
 * position in the buffer, ask what the previous significant token
 * is. If it is a trailing-incomplete operator or keyword (modulo the
 * postfix-only `++` / `--` carve-out), the buffer is incomplete.
 *
 * Examples that flag incomplete:
 *
 *   - `for (let i = )` — last token before `)` is `=`.
 *   - `const arr = [1, ]` — last token before `]` is `,`.
 *   - `items.map((x) => )` — last token before final `)` is `=>`.
 *   - `if (x === )` — last token before `)` is `===`.
 *
 * Carve-outs (stay ready):
 *
 *   - `() => {}` — `}` is preceded by `{`, not by an operator.
 *   - `(a + b)` — last token before `)` is `b`.
 *   - `[1, 2]` — last token before `]` is `2`.
 *   - `i++)` — `++` is a postfix operator and does not need a right
 *     operand; treat as complete.
 */
function hasAutoPairTrap(stripped: string): boolean {
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (c !== ')' && c !== ']' && c !== '}') continue;
    // Walk backward past whitespace.
    let j = i - 1;
    while (j >= 0 && isWhitespaceChar(stripped[j] ?? '')) j--;
    if (j < 0) continue;
    // Read the previous token at position j, walking backward.
    const previousToken = lastSignificantTokenBefore(stripped, j + 1);
    if (previousToken === '') continue;
    // Postfix `++` and `--` legitimately appear before `)`. They are
    // self-contained operators that produce a value.
    if (previousToken === '++' || previousToken === '--') continue;
    if (TRAILING_INCOMPLETE_OPERATORS.has(previousToken)) return true;
    if (TRAILING_INCOMPLETE_KEYWORDS.has(previousToken)) return true;
  }
  return false;
}

/**
 * Public gate. Returns `{ ready: true }` for non-JS/TS languages,
 * empty buffers, and otherwise-balanced JS/TS source. Returns
 * `{ ready: false, reason: 'incomplete' }` when the source has an
 * unclosed structural region (bracket, quote, template, block
 * comment), ends on a trailing operator / keyword, or contains an
 * auto-pair-trapped operator hanging before a close-bracket.
 */
export function isLikelyComplete(
  language: string,
  code: string
): AutoRunGateResult {
  if (code.trim() === '') {
    return { ready: false, reason: 'empty' };
  }

  if (!isGatedLanguage(language)) {
    return { ready: true, reason: 'ok' };
  }

  const scan = scanSource(code);

  if (
    scan.unbalanced ||
    scan.openTemplatePlaceholder ||
    scan.openQuote ||
    scan.openBlockComment
  ) {
    return { ready: false, reason: 'incomplete' };
  }

  // Auto-pair defense. Walks the comment-stripped buffer once; cheap.
  if (hasAutoPairTrap(scan.stripped)) {
    return { ready: false, reason: 'incomplete' };
  }

  const token = lastSignificantToken(scan.stripped);
  if (token === '') {
    // Comment-only buffers have no significant token; treat as ok
    // because there is nothing to execute anyway.
    return { ready: true, reason: 'ok' };
  }

  if (TRAILING_INCOMPLETE_OPERATORS.has(token)) {
    return { ready: false, reason: 'incomplete' };
  }

  if (TRAILING_INCOMPLETE_KEYWORDS.has(token)) {
    return { ready: false, reason: 'incomplete' };
  }

  return { ready: true, reason: 'ok' };
}
