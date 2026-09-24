/**
 * JS / TS arrow (`//=>`) and watch (`// @watch expr`) detection plus the
 * source transform that rewrites each matched line into an `__mc(line,
 * value)` capture.
 */

import MagicString from 'magic-string';
import { finishSourceTransform, wrapSourceExpression, type RecordSourceMap } from '../sourceTransform';

import { parseDirective } from './directives';
import type { MagicCommentLine } from './types';

const JS_WATCH_RE = /^(.*?)\/\/\s*@watch\s+(.+?)\s*$/;
// implementation — capture EVERYTHING after `=>` as the tail so we
// preserve the legacy `//=> free-form annotation` shape (the tail
// becomes a description, not a directive). The tail is then parsed
// by `parseDirective` which only returns a directive when the
// trimmed tail is exactly one of the recognised words — anything
// else falls through to the legacy arrow behaviour.
const JS_ARROW_RE = /^(.+?)\/\/\s*=>(.*)$/;

function detectJSLine(line: string): MagicCommentLine | null {
  // implementation — watch wins over arrow when both shapes match.
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
 *     wrapping the prefix expression (same as before implementation).
 *   - **Watch** — KEEP the prefix as-is and append `; __mc(line,
 *     value)` so the original statement still runs alongside the
 *     watch capture.
 */
export function transformJSMagicComments(code: string, recordMap?: RecordSourceMap): string {
  const source = new MagicString(code);
  let offset = 0;
  for (const [index, line] of code.split('\n').entries()) {
    const detected = detectJSLine(line);
    if (detected) {
      const cleanExpr = detected.expression.replace(/;$/, '');
      const expressionStart = detected.kind === 'arrow'
        ? line.indexOf(detected.expression)
        : line.lastIndexOf(detected.expression);
      const prefix = detected.preserve;
      const separator = prefix.length > 0 && !/[;{}]\s*$/.test(prefix) ? ';' : '';
      wrapSourceExpression(source, {
        start: offset + (detected.kind === 'watch' ? prefix.length : 0),
        end: offset + line.length,
        expressionStart: offset + expressionStart,
        expressionEnd: offset + expressionStart + cleanExpr.length,
        prefix: `${detected.kind === 'watch' ? separator + ' ' : ''}void (__mc(${index + 1}, (() => { try { return (`,
        suffix: '); } catch(e) { return e instanceof Error ? e : new Error(String(e)); } })()));',
      });
    }
    offset += line.length + 1;
  }
  return finishSourceTransform(source, recordMap);
}
