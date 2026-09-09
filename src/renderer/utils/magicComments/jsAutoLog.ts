/**
 * The opt-in JS / TS auto-log pass: detect top-level bare expression
 * statements, then rewrite each one into a single `__mc(line, value)`
 * capture so the value surfaces inline without an explicit `//=>`.
 */

import {
  EMPTY_MAGIC_LINES,
  scanAutoLogCandidates,
  stripTrailingSemicolons,
  trimLine,
} from './jsLexer';

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
  return `__mc(${lineNumber}, await (async () => { try { return (${expression}); } catch(__e) { return __e instanceof Error ? __e : new Error(String(__e)); } })())`;
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
