/**
 * Python arrow (`#=>`) and watch (`# @watch expr`) detection and
 * transform. Python auto-log is worker-owned (CPython AST inside
 * Pyodide) and intentionally absent here.
 */

import { parseDirective } from './directives';
import type { MagicCommentLine } from './types';

const PY_WATCH_RE = /^(.*?)#\s*@watch\s+(.+?)\s*$/;
// implementation — same shape as the JS arrow regex: capture the
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
 * implementation). For watch lines, the prefix statement is kept and the
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
    // implementation / 2b — forward the parsed directive into the
    // `__mc` runner. `table` lets the Python worker attach a forced-table
    // payload; rich-media directives use JSON text so the runner can
    // recover chart / image / html payloads client-side.
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
