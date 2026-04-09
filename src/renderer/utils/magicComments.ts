/**
 * Magic comment transformation for inline expression evaluation.
 *
 * Detects `//=>` (JS/TS) or `#=>` (Python) at the end of a line,
 * extracts the expression preceding the marker, and wraps it to
 * capture the evaluated value at runtime.
 */

export interface MagicCommentLine {
  /** 1-based line number in the original source */
  line: number;
  /** The expression text before the magic marker */
  expression: string;
}

// ---------------------------------------------------------------------------
// JS / TS transform
// ---------------------------------------------------------------------------

const JS_MAGIC_RE = /^(.+?)\/\/\s*=>.*$/;

/**
 * Detect magic comment lines in JS/TS source code.
 */
export function detectJSMagicComments(code: string): MagicCommentLine[] {
  const results: MagicCommentLine[] = [];
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = JS_MAGIC_RE.exec(lines[i]!);
    if (match?.[1]) {
      const expression = match[1].trim();
      if (expression) {
        results.push({ line: i + 1, expression });
      }
    }
  }
  return results;
}

/**
 * Transform JS/TS code so that magic-comment expressions are captured.
 *
 * For each line containing `//=>`, wraps the expression in a
 * `__mc(lineNumber, expression)` call that logs the value
 * via a special console channel.
 */
export function transformJSMagicComments(code: string): string {
  const lines = code.split('\n');
  const transformed: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = JS_MAGIC_RE.exec(line);
    if (match?.[1]) {
      const expression = match[1].trim();
      if (expression) {
        // Strip trailing semicolon from the expression if present
        const cleanExpr = expression.replace(/;$/, '');
        transformed.push(
          `void (__mc(${i + 1}, (() => { try { return (${cleanExpr}); } catch(e) { return e instanceof Error ? e.message : String(e); } })()));`
        );
        continue;
      }
    }
    transformed.push(line);
  }

  return transformed.join('\n');
}

// ---------------------------------------------------------------------------
// Python transform
// ---------------------------------------------------------------------------

const PY_MAGIC_RE = /^(.+?)#\s*=>.*$/;

/**
 * Detect magic comment lines in Python source code.
 */
export function detectPythonMagicComments(code: string): MagicCommentLine[] {
  const results: MagicCommentLine[] = [];
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = PY_MAGIC_RE.exec(lines[i]!);
    if (match?.[1]) {
      const expression = match[1].trim();
      if (expression) {
        results.push({ line: i + 1, expression });
      }
    }
  }
  return results;
}

/**
 * Transform Python code so that magic-comment expressions are captured.
 *
 * Replaces each magic-comment line with a `__mc(line, expr)` call
 * that prints a JSON marker the worker can parse.
 */
export function transformPythonMagicComments(code: string): string {
  const lines = code.split('\n');
  const transformed: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = PY_MAGIC_RE.exec(line);
    if (match?.[1]) {
      const expression = match[1].trim();
      if (expression) {
        transformed.push(
          `__mc(${i + 1}, lambda: (${expression}))`
        );
        continue;
      }
    }
    transformed.push(line);
  }

  return transformed.join('\n');
}
