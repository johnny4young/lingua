/**
 * Magic comment transformation for inline expression evaluation.
 *
 * Two variants:
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
 * Both variants funnel through the same `__mc` runner injection — no
 * worker protocol change. The per-line `kind` lives in a side-table
 * the runner reads when stitching results back into `LineResult[]`.
 */

export type MagicCommentKind = 'arrow' | 'watch';

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
}

// ---------------------------------------------------------------------------
// JS / TS transform
// ---------------------------------------------------------------------------

const JS_WATCH_RE = /^(.*?)\/\/\s*@watch\s+(.+?)\s*$/;
const JS_ARROW_RE = /^(.+?)\/\/\s*=>.*$/;

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
      return { line: 0, expression, kind: 'arrow', preserve: '' };
    }
  }
  return null;
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
// Python transform
// ---------------------------------------------------------------------------

const PY_WATCH_RE = /^(.*?)#\s*@watch\s+(.+?)\s*$/;
const PY_ARROW_RE = /^(.+?)#\s*=>.*$/;

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
      return { line: 0, expression, kind: 'arrow', preserve: '' };
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
    const mcCall = `__mc(${lineNumber}, lambda: (${detected.expression}))`;
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
 * RL-020 Slice 3 — derive the per-line `kind` map for a given source.
 * Runners use this side-table at result-stitching time to tag each
 * incoming `magic-comment` worker message with `'arrow'` vs `'watch'`
 * (the worker postMessage protocol is intentionally kind-agnostic).
 *
 * Returns a sparse `Record<lineNumber, MagicCommentKind>`; lookup
 * defaults to `'arrow'` for any unrecognized line — the worker would
 * not have emitted a message for that line in the first place, so
 * the fallback is purely defensive.
 */
export function magicCommentKindsByLine(
  language: 'javascript' | 'typescript' | 'python',
  code: string
): Record<number, MagicCommentKind> {
  const detected =
    language === 'python'
      ? detectPythonMagicComments(code)
      : detectJSMagicComments(code);
  const map: Record<number, MagicCommentKind> = {};
  for (const entry of detected) {
    map[entry.line] = entry.kind;
  }
  return map;
}
