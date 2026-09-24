/**
 * Per-statement timing instrumentation for JS / TS: find the lines that
 * open a new top-level statement, then prefix each with a
 * `__mc_tick(<line>);` marker without changing the buffer's line count.
 */

import MagicString from 'magic-string';
import { finishSourceTransform, type RecordSourceMap } from '../sourceTransform';

import {
  endsWithTrailingContinuation,
  stripTrailingSemicolons,
  trimLine,
  walkTopLevelLines,
} from './jsLexer';

/**
 * First characters that mark a physical line as the CONTINUATION of the
 * previous statement (member chains, ternaries, operators, call/index
 * brackets, template tags) rather than a fresh statement. Prefixing a
 * tick there would change program meaning or break the parse, so such
 * lines are never instrumented.
 */
const STATEMENT_START_BLOCKED_CHARS = '.?:)]},=+-*/%&|^<>!~`([@';

/**
 * Leading keywords that continue a compound statement. `while` is here
 * for the rare split `do {…}\n while (…)` tail — excluding it costs a
 * standalone while-loop its own marker (its time implementation note the
 * previous statement) but can never produce invalid code, which is the
 * bias this detector wants.
 */
const STATEMENT_START_BLOCKED_KEYWORDS = new Set([
  'else',
  'catch',
  'finally',
  'while',
  'case',
  'default',
  'extends',
  'implements',
  'instanceof',
  'in',
  'of',
]);

function startsNewTopLevelStatement(trimmed: string): boolean {
  const first = trimmed[0] ?? '';
  if (first.length === 0) return false;
  if (STATEMENT_START_BLOCKED_CHARS.includes(first)) return false;
  const wordMatch = trimmed.match(/^[A-Za-z_$][A-Za-z0-9_$]*/u);
  if (wordMatch && STATEMENT_START_BLOCKED_KEYWORDS.has(wordMatch[0])) {
    return false;
  }
  return true;
}

/**
 * internal — 1-based line numbers where a NEW top-level statement begins.
 *
 * Deliberately conservative: a missed line only merges its duration
 * into the previous statement's measurement, while a false positive
 * would inject a tick mid-statement and break the user's code. A line
 * qualifies only when it starts at depth 0 outside any open token, has
 * real content, does not begin with a continuation token/keyword, and
 * the previous significant line finished its statement (returned to
 * depth 0 without a trailing continuation character).
 */
export function detectJSStatementStartLines(code: string): number[] {
  if (code.length === 0) return [];
  const out: number[] = [];
  let previousEndedStatement = true;
  let inDirectivePrologue = true;

  walkTopLevelLines(code, (info) => {
    const trimmed = trimLine(info.stripped);
    if (trimmed.length === 0) return; // blank / comment-only — invisible
    const startsWithQuote = trimmed[0] === "'" || trimmed[0] === '"';
    // A directive prologue must remain the first statements in its scope.
    // Prefixing `'use strict'` / `"use client"` with a timing call turns
    // it into a normal expression and changes runtime semantics. Once a
    // non-string statement appears, later string expressions are safe to time.
    const isDirectivePrologueLine = inDirectivePrologue && startsWithQuote;
    const qualifies =
      info.depthAtStart === 0 &&
      !info.openTokenAtStart &&
      previousEndedStatement &&
      !isDirectivePrologueLine &&
      startsNewTopLevelStatement(trimmed);
    if (qualifies) out.push(info.lineNumber);

    if (inDirectivePrologue && !startsWithQuote) {
      inDirectivePrologue = false;
    }

    const tail = stripTrailingSemicolons(trimmed);
    previousEndedStatement =
      info.depthAtEnd === 0 &&
      !info.openTokenAtEnd &&
      (tail.length === 0 || !endsWithTrailingContinuation(tail));
  });

  return out;
}

/**
 * internal — prefix each detected statement-start line with a
 * `__mc_tick(<line>);` marker. Same-line prefixing keeps the buffer's
 * line count intact, so every later mapping (error stacks, other
 * transforms) stays valid. There is NO closing marker in the source:
 * the worker flushes the final open tick itself when execution settles,
 * which sidesteps the append-after-last-line hazards entirely.
 */
export function transformJSLineTiming(
  code: string,
  statementLines: ReadonlyArray<number>,
  recordMap?: RecordSourceMap
): string {
  if (statementLines.length === 0) return code;
  const source = new MagicString(code);
  const targets = new Set(statementLines);
  let offset = 0;
  for (const [index, line] of code.split('\n').entries()) {
    if (targets.has(index + 1)) {
      const indent = line.length - line.trimStart().length;
      source.appendLeft(offset + indent, `__mc_tick(${index + 1}); `);
    }
    offset += line.length + 1;
  }
  return finishSourceTransform(source, recordMap);
}
