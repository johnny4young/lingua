/**
 * RL-020 Slice 3 fold E — pure helper that decides how to append a
 * `// @watch <expr>` (or `# @watch <expr>` for Python) marker to a
 * line of code.
 *
 * Behavior:
 *
 *   - If the line already carries a watch marker, returns the line
 *     unchanged (idempotent — palette press a second time is a no-op).
 *
 *   - If the line already carries an arrow `//=>` / `#=>` marker, the
 *     arrow is replaced with a watch on the same expression. This
 *     promotes the user's ad-hoc peek into a pinned watch.
 *
 *   - Otherwise, infers an expression from the line's trailing
 *     non-whitespace content (after stripping trailing `;`) and
 *     appends ` // @watch <expr>` (or `  # @watch <expr>` for
 *     Python). Empty / comment-only lines short-circuit with `null`
 *     so the caller surfaces a "no expression to watch" notice.
 *
 *   - Honours the language-specific comment shape (`//` vs `#`).
 *
 * Pure module — no DOM, no Monaco, vitest-safe under node env.
 */

export type AppendWatchLanguage = 'javascript' | 'typescript' | 'python';

const WATCH_MARKER_RE: Record<AppendWatchLanguage, RegExp> = {
  javascript: /\/\/\s*@watch\s+/,
  typescript: /\/\/\s*@watch\s+/,
  python: /#\s*@watch\s+/,
};

const ARROW_MARKER_RE: Record<AppendWatchLanguage, RegExp> = {
  javascript: /\/\/\s*=>.*$/,
  typescript: /\/\/\s*=>.*$/,
  python: /#\s*=>.*$/,
};

const COMMENT_PREFIX: Record<AppendWatchLanguage, string> = {
  javascript: '//',
  typescript: '//',
  python: '#',
};

/**
 * Strip a trailing `;` from the inferred expression so the resulting
 * watch transform never produces a function body that reads as a
 * statement.
 */
function cleanExpression(text: string): string {
  return text.trim().replace(/;\s*$/, '').trim();
}

const JS_DECLARATION_RE = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
const PY_DECLARATION_RE = /^\s*([A-Za-z_][\w]*)\s*=(?!=)/;
const JS_UNWATCHABLE_STATEMENT_RE =
  /^(?:if|for|while|switch|try|catch|finally|else|do|function|class|import|export|return|throw|break|continue)\b/;
const PY_UNWATCHABLE_STATEMENT_RE =
  /^(?:if|for|while|with|try|except|else|elif|finally|def|class|match|case|return|raise|break|continue|pass|import|from|global|nonlocal|yield|assert|del)\b/;

/**
 * Derive the watched expression from a raw line. Declarations like
 * `const b = 2;` collapse to the bound identifier `b` because a
 * statement cannot be evaluated as an expression — the user wants to
 * watch the binding's value, not the assignment statement. Naked
 * expressions fall through to the trimmed line minus its trailing
 * `;`.
 */
function inferExpression(
  line: string,
  language: AppendWatchLanguage
): string {
  const declarationRe = language === 'python' ? PY_DECLARATION_RE : JS_DECLARATION_RE;
  const match = line.match(declarationRe);
  if (match && match[1]) {
    return match[1];
  }
  return cleanExpression(line);
}

function isWatchableStatement(
  line: string,
  language: AppendWatchLanguage
): boolean {
  const cleaned = cleanExpression(line);
  if (!cleaned) return false;

  const declarationRe = language === 'python' ? PY_DECLARATION_RE : JS_DECLARATION_RE;
  if (declarationRe.test(line)) return true;

  if (language === 'python') {
    if (cleaned.endsWith(':')) return false;
    return !PY_UNWATCHABLE_STATEMENT_RE.test(cleaned);
  }

  if (cleaned.endsWith('{') || cleaned === '}' || cleaned === '};') return false;
  return !JS_UNWATCHABLE_STATEMENT_RE.test(cleaned);
}

/**
 * Returns the line with a watch marker appended, or `null` when the
 * line has no expression to watch (empty, whitespace-only, or
 * already a comment).
 */
export function appendWatchToLine(
  line: string,
  language: AppendWatchLanguage
): string | null {
  if (WATCH_MARKER_RE[language].test(line)) {
    return line; // idempotent — already a watch line
  }
  // Python convention is `  # @watch …` (two spaces before `#`) so
  // we match PEP 8 inline-comment style. JS / TS use a single space.
  const spacer = language === 'python' ? '  ' : ' ';
  const arrowMatch = line.match(ARROW_MARKER_RE[language]);
  if (arrowMatch) {
    // Promote arrow into watch. The expression is the line's prefix
    // (declaration → identifier; naked expression → trimmed text)
    // so the resulting watch is always evaluable at runtime.
    const prefix = line.slice(0, arrowMatch.index ?? 0);
    const expression = inferExpression(prefix, language);
    if (!expression) return null;
    return `${prefix.trimEnd()}${spacer}${COMMENT_PREFIX[language]} @watch ${expression}`;
  }
  const cleaned = cleanExpression(line);
  if (!cleaned) return null;
  // Sanity: don't double-comment a line that is itself a comment.
  const commented =
    (language === 'python' && cleaned.startsWith('#')) ||
    (language !== 'python' && cleaned.startsWith('//'));
  if (commented) return null;
  // Refuse statements where the helper cannot infer an expression
  // that will execute after insertion. This keeps the palette action
  // from producing syntactically-invalid or unreachable watches on
  // control-flow / return / import lines.
  if (!isWatchableStatement(line, language)) return null;
  const expression = inferExpression(line, language);
  if (!expression) return null;
  return `${line.replace(/\s+$/, '')}${spacer}${COMMENT_PREFIX[language]} @watch ${expression}`;
}

/**
 * Apply `appendWatchToLine` to a specific 1-based line in a full
 * source buffer. Returns the updated buffer or `null` when the
 * targeted line has no expression to watch / line index is out of
 * range.
 */
export function appendWatchAtLine(
  source: string,
  lineNumber: number,
  language: AppendWatchLanguage
): string | null {
  if (lineNumber < 1) return null;
  const lines = source.split('\n');
  if (lineNumber > lines.length) return null;
  const target = lines[lineNumber - 1] ?? '';
  const next = appendWatchToLine(target, language);
  if (next === null || next === target) return null;
  lines[lineNumber - 1] = next;
  return lines.join('\n');
}

/**
 * Is `@watch` syntactically meaningful for this language pack?
 * Used by the command-palette action to grey out unsupported
 * languages with a localized notice instead of silently failing.
 */
export function isAppendWatchSupported(language: string): language is AppendWatchLanguage {
  return language === 'javascript' || language === 'typescript' || language === 'python';
}
