/**
 * The opt-in JS / TS auto-log pass: detect top-level bare expression
 * statements, then rewrite each one into a single `__mc(line, value)`
 * capture so the value surfaces inline without an explicit `//=>`.
 */

import MagicString from 'magic-string';
import type { ExecutionContext } from '../../types/execution';
import { finishSourceTransform, wrapSourceExpression, type RecordSourceMap } from '../sourceTransform';

import { detectJSAssignmentAnswers, type JSAssignmentAnswer } from './jsAssignments';
import {
  EMPTY_MAGIC_LINES,
  scanAutoLogCandidates,
  stripTrailingSemicolons,
  trimLine,
  walkLines,
} from './jsLexer';

/** Which top-level statements answer: bare expressions, plus bindings for `'assignments'`. */
type JSAutoLogMode = ExecutionContext['autoLog'];

interface JSAutoLogPlan {
  expressionLines: number[];
  bindings: JSAssignmentAnswer[];
}

function planJSAutoLog(code: string, magicLines: ReadonlySet<number>, mode: JSAutoLogMode): JSAutoLogPlan {
  if (code.length === 0 || (mode !== true && mode !== 'assignments')) return { expressionLines: [], bindings: [] };
  if (mode === true) return { expressionLines: scanAutoLogCandidates(code, magicLines), bindings: [] };
  const walked = walkLines(code);
  const expressionLines = scanAutoLogCandidates(code, magicLines, walked);
  const claimed = new Set(expressionLines);
  const bindings = detectJSAssignmentAnswers(code, magicLines, walked).filter((answer) => !claimed.has(answer.line));
  return { expressionLines, bindings };
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
 * @param mode `'assignments'` also answers top-level bindings (Scratchpad auto-runs).
 */
export function detectJSAutoLogLines(
  code: string,
  magicLines: ReadonlySet<number> = EMPTY_MAGIC_LINES,
  mode: JSAutoLogMode = true
): number[] {
  const { expressionLines, bindings } = planJSAutoLog(code, magicLines, mode);
  return bindings.length === 0 ? expressionLines : [...expressionLines, ...bindings.map((answer) => answer.line)];
}

/**
 * The runner-side pass: detect on `source` (before magic-comment rewrites)
 * and transform `code`. Returns the rewritten code and every answering line;
 * modes other than `true` and `'assignments'` leave the code as it is.
 */
export function applyJSAutoLog(
  source: string,
  code: string,
  magicLines: ReadonlySet<number>,
  mode: JSAutoLogMode,
  recordMap?: RecordSourceMap
): { code: string; lines: number[] } {
  const { expressionLines, bindings } = planJSAutoLog(source, magicLines, mode);
  if (expressionLines.length === 0 && bindings.length === 0) return { code, lines: [] };
  return {
    code: transformJSAutoLog(code, expressionLines, recordMap, bindings),
    lines: [...expressionLines, ...bindings.map((answer) => answer.line)],
  };
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

/**
 * Transform a JS / TS buffer by replacing every line listed in
 * `autoLogLines` with a single `__mc(line, value)` capture. The
 * expression executes once; indentation and trailing line comments
 * are preserved for readability.
 *
 * Call this AFTER `transformJSMagicComments` so magic-comment lines
 * (which `detectJSAutoLogLines` already excludes) keep their
 * specialised transform shape. Each of `assignments` reads its name back
 * with `__mc` right after its statement, before any trailing comment.
 */
export function transformJSAutoLog(
  code: string,
  autoLogLines: ReadonlyArray<number>,
  recordMap?: RecordSourceMap,
  assignments: ReadonlyArray<JSAssignmentAnswer> = []
): string {
  if (autoLogLines.length === 0 && assignments.length === 0) return code;
  const source = new MagicString(code);
  const targets = new Set(autoLogLines);
  const capturesByEndLine = new Map(assignments.map((answer) => [answer.endLine, answer]));
  let offset = 0;
  for (const [index, original] of code.split('\n').entries()) {
    const capture = capturesByEndLine.get(index + 1);
    if (capture) source.appendLeft(offset + capture.endColumn, `;void __mc(${capture.line}, ${capture.name});`);
    if (targets.has(index + 1)) {
      const { code: expressionCode, comment } = original.includes('//')
        ? splitTrailingLineComment(original)
        : { code: original, comment: '' };
      const expression = stripTrailingSemicolons(trimLine(expressionCode));
      if (expression) {
        const start = original.indexOf(expression);
        wrapSourceExpression(source, {
          start: offset + start,
          end: offset + original.length,
          expressionStart: offset + start,
          expressionEnd: offset + start + expression.length,
          prefix: `void (__mc(${index + 1}, await (async () => { try { return (`,
          suffix: `); } catch(__e) { return __e instanceof Error ? __e : new Error(String(__e)); } })()));${comment ? ' ' + comment : ''}`,
        });
      }
    }
    offset += original.length + 1;
  }
  return finishSourceTransform(source, recordMap);
}
