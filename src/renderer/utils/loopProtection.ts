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
 * Strategy: Initialize a counter variable before each loop, then
 * increment and check it as the first statement inside the loop body.
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
      // Initialize counter before the loop
      result.push(`var ${counter}=0;`);
      // Original loop line
      result.push(line);
      // Check inside the loop body (after the opening brace)
      result.push(`  if(++${counter}>${maxIterations}) throw new Error("Loop exceeded ${maxIterations} iterations (line ${i + 1}). Possible infinite loop.");`);
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
  const lines = code.split('\n');
  const result: string[] = [];
  let loopId = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();
    const indent = line.slice(0, line.length - trimmed.length);

    // Detect Python loop patterns: `for ... :` or `while ... :`
    const isLoop = /^(for|while)\s+.+:\s*$/.test(trimmed);

    if (isLoop) {
      const id = loopId++;
      const counterVar = `__lp${id}`;
      // Insert counter initialization before the loop
      result.push(`${indent}${counterVar} = 0`);
      result.push(line);
      // Insert guard as first line in the loop body (one extra indent level)
      const bodyIndent = indent + '    ';
      result.push(`${bodyIndent}${counterVar} += 1`);
      result.push(`${bodyIndent}if ${counterVar} > ${maxIterations}: raise RuntimeError("Loop exceeded ${maxIterations} iterations (line ${i + 1}). Possible infinite loop.")`);
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}
