/**
 * Loop protection transformation.
 *
 * Injects iteration counters into `for`, `while`, and `do-while` loops
 * to halt execution when the iteration count exceeds a configurable limit.
 * Prevents infinite loops from freezing the application.
 */

export const DEFAULT_MAX_ITERATIONS = 10_000;

// ---------------------------------------------------------------------------
// JS / TS loop protection
// ---------------------------------------------------------------------------

/**
 * Inject loop protection into JavaScript/TypeScript code.
 *
 * Strategy: initialize a counter immediately before each loop and
 * increment/check it as the first statement inside the loop body.
 * The injected JS stays on the loop's original source line so inline
 * results and stack-derived console locations keep matching the editor.
 * Each loop gets a unique counter to support nesting.
 */
export function injectJSLoopProtection(code: string, maxIterations: number = DEFAULT_MAX_ITERATIONS): string {
  const lines = code.split('\n');
  const result: string[] = [];
  let loopId = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();

    // Detect loop start patterns ending with `{`
    const isWhileLoop = /^\s*while\s*\(/.test(line) && trimmed.endsWith('{');
    const isForLoop = /^\s*for\s*\(/.test(line) && trimmed.endsWith('{');
    const isDoLoop = /^\s*do\s*\{/.test(line) || trimmed === 'do {';

    if (isWhileLoop || isForLoop || isDoLoop) {
      const id = loopId++;
      const counter = `__lp${id}`;
      const indent = line.slice(0, line.length - trimmed.length);
      const loopHead = line.slice(indent.length);
      const guard = `if(++${counter}>${maxIterations}) throw new Error("Loop exceeded ${maxIterations} iterations (line ${i + 1}). Possible infinite loop.");`;
      result.push(`${indent}var ${counter}=0; ${loopHead} ${guard}`);
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Python loop protection
// ---------------------------------------------------------------------------

/**
 * Inject loop protection into Python code.
 *
 * Strategy: Before each `for` or `while` loop, initialize a counter.
 * At the start of the loop body (the indented block), inject a guard.
 */
export function injectPythonLoopProtection(code: string, maxIterations: number = DEFAULT_MAX_ITERATIONS): string {
  return injectPythonLoopProtectionWithLineMap(code, maxIterations).code;
}

export interface PythonLoopProtectionResult {
  code: string;
  /**
   * Generated-line -> original-line map. Python loop protection inserts
   * counter/guard lines, so runtime frame line numbers need this map
   * before they are rendered as inline output next to source code.
   */
  sourceLineMap: Record<number, number>;
}

export function injectPythonLoopProtectionWithLineMap(
  code: string,
  maxIterations: number = DEFAULT_MAX_ITERATIONS
): PythonLoopProtectionResult {
  const lines = code.split('\n');
  const result: string[] = [];
  const sourceLineMap: Record<number, number> = {};
  let loopId = 0;

  const pushGenerated = (line: string, originalLine: number) => {
    result.push(line);
    sourceLineMap[result.length] = originalLine;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const originalLine = i + 1;
    const trimmed = line.trimStart();
    const indent = line.slice(0, line.length - trimmed.length);

    // Detect Python loop patterns: `for ... :` or `while ... :`
    const isLoop = /^(for|while)\s+.+:\s*$/.test(trimmed);

    if (isLoop) {
      const id = loopId++;
      const counterVar = `__lp${id}`;
      // Insert counter initialization before the loop
      pushGenerated(`${indent}${counterVar} = 0`, originalLine);
      pushGenerated(line, originalLine);
      // Insert guard as first line in the loop body (one extra indent level)
      const bodyIndent = indent + '    ';
      pushGenerated(`${bodyIndent}${counterVar} += 1`, originalLine);
      pushGenerated(`${bodyIndent}if ${counterVar} > ${maxIterations}: raise RuntimeError("Loop exceeded ${maxIterations} iterations (line ${i + 1}). Possible infinite loop.")`, originalLine);
    } else {
      pushGenerated(line, originalLine);
    }
  }

  return { code: result.join('\n'), sourceLineMap };
}
