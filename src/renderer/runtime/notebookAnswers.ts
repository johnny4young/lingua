/**
 * Per-line answers for notebook cells: the instrumentation each kernel needs
 * and the conversion of its run result into `NotebookLineAnswerV1` rows.
 */

import { parse } from 'acorn';
import type { Node as AcornNode } from 'acorn';
import {
  MAX_ANSWERS_PER_CELL,
  MAX_ANSWER_TEXT_LENGTH,
  type NotebookLineAnswerKind,
  type NotebookLineAnswerV1,
} from '../../shared/notebook';
import {
  isReadOnlySqlStatement,
  skipSqlToken,
  splitSqlStatements,
  sqlCodeOnly,
} from '../../shared/sqlStatements';
import { truncateText } from '../../shared/truncateText';
import type { ExecutionResult } from '../types/execution';
import { getLastNonEmptyLine, toLineResults } from '../utils/executionPresentation';

/** Name of the capture the JS instrumentation calls; defined by the composed cell body. */
export const NOTEBOOK_ANSWER_FN = '__notebook_answer';

/** Raw answer the composed JS body records; `line` is in the instrumented JS. */
export interface NotebookJsAnswerCapture {
  readonly line: number;
  readonly text: string;
  readonly type?: string;
  readonly size?: number;
}

export function capAnswerText(text: string): string {
  return truncateText(text.replace(/\s*\n\s*/g, ' '), MAX_ANSWER_TEXT_LENGTH);
}

function lineCount(source: string): number {
  return source.split('\n').length;
}

/**
 * Wrap every top-level expression statement as `__notebook_answer(line, (expr))`
 * on its own line, so the instrumented source keeps the original line count.
 * Broken input comes back unchanged and the run reports the syntax error.
 */
export function instrumentJsAnswers(source: string): string {
  let program;
  try {
    program = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      locations: true,
    });
  } catch {
    return source;
  }
  const wraps: Array<{ start: number; end: number; line: number }> = [];
  for (const statement of program.body) {
    if (statement.type !== 'ExpressionStatement') continue;
    if ((statement as { directive?: string }).directive !== undefined) continue;
    const expression = statement.expression as AcornNode;
    wraps.push({
      start: expression.start,
      end: expression.end,
      line: expression.loc?.start.line ?? 1,
    });
  }
  const pieces: string[] = [];
  let cursor = 0;
  for (const { start, end, line } of wraps) {
    pieces.push(source.slice(cursor, start), `${NOTEBOOK_ANSWER_FN}(${line}, (`, source.slice(start, end), '))');
    cursor = end;
  }
  pieces.push(source.slice(cursor));
  return pieces.join('');
}

/**
 * Collapse raw rows to one answer per line and kind (the last write wins, an
 * error keeps the first), drop lines outside the source and cap the list.
 */
export function finalizeAnswers(
  rows: ReadonlyArray<NotebookLineAnswerV1>,
  source: string
): NotebookLineAnswerV1[] {
  const max = lineCount(source);
  const byKey = new Map<string, NotebookLineAnswerV1>();
  for (const row of rows) {
    if (!Number.isInteger(row.line) || row.line < 1 || row.line > max) continue;
    const key = `${row.line}:${row.kind}`;
    if (row.kind === 'error' && byKey.has(key)) continue;
    byKey.delete(key);
    byKey.set(key, { ...row, text: capAnswerText(row.text) });
  }
  return [...byKey.values()]
    .sort((a, b) => a.line - b.line)
    .slice(0, MAX_ANSWERS_PER_CELL);
}

function answer(
  line: number,
  kind: NotebookLineAnswerKind,
  text: string,
  extra: Partial<NotebookLineAnswerV1> = {}
): NotebookLineAnswerV1 {
  return { line, kind, text, ...extra };
}

/**
 * JS / TS cells. `mapLine` turns a line of the instrumented JavaScript into a
 * line of the cell source (identity for JS, the source map for TS) and
 * returns null when the line has no counterpart.
 */
export function jsAnswers(input: {
  readonly source: string;
  readonly captures: ReadonlyArray<NotebookJsAnswerCapture>;
  readonly stdout: ReadonlyArray<{ readonly text: string; readonly line: number | null }>;
  readonly stderr: ReadonlyArray<{ readonly text: string; readonly line: number | null }>;
  readonly error?: { readonly message: string; readonly line: number | null };
  readonly mapLine: (line: number) => number | null;
}): NotebookLineAnswerV1[] {
  const rows: NotebookLineAnswerV1[] = [];
  for (const output of input.stdout) {
    const line = output.line === null ? null : input.mapLine(output.line);
    if (line !== null) rows.push(answer(line, 'output', output.text));
  }
  for (const output of input.stderr) {
    const line = output.line === null ? null : input.mapLine(output.line);
    if (line !== null) rows.push(answer(line, 'error', output.text));
  }
  for (const capture of input.captures) {
    const line = input.mapLine(capture.line);
    if (line === null) continue;
    rows.push(
      answer(line, capture.type === 'error' ? 'error' : 'value', capture.text, {
        ...(capture.type ? { type: capture.type } : {}),
        ...(capture.size !== undefined ? { size: capture.size } : {}),
      })
    );
  }
  if (input.error) {
    const mapped = input.error.line === null ? null : input.mapLine(input.error.line);
    rows.push(answer(mapped ?? getLastNonEmptyLine(input.source), 'error', input.error.message));
  }
  return finalizeAnswers(rows, input.source);
}

/** A Python `repr` read back into a type name and, for collections, a length. */
export function pythonValueType(repr: string): { type?: string; size?: number } {
  const text = repr.trim();
  if (text === 'None') return { type: 'None' };
  if (text === 'True' || text === 'False') return { type: 'bool' };
  if (/^-?\d+$/.test(text)) return { type: 'int' };
  if (/^-?(\d+\.\d*|\.\d+|\d+)(e[+-]?\d+)?$/i.test(text) || /^-?(inf|nan)$/.test(text)) {
    return { type: 'float' };
  }
  if (/^b(['"]).*\1$/s.test(text)) return { type: 'bytes' };
  if (/^(['"]).*\1$/s.test(text)) return { type: 'str' };
  const open = text[0];
  const close = text[text.length - 1];
  const kind =
    open === '[' && close === ']'
      ? 'list'
      : open === '(' && close === ')'
        ? 'tuple'
        : open === '{' && close === '}'
          ? text.slice(1, -1).includes(':') || text === '{}'
            ? 'dict'
            : 'set'
          : null;
  if (!kind) return {};
  return { type: kind, size: countTopLevelItems(text.slice(1, -1)) };
}

/** Items in a repr body, counting commas outside nested brackets and strings. */
function countTopLevelItems(body: string): number {
  if (!body.trim()) return 0;
  let depth = 0;
  let quote: string | null = null;
  let items = 1;
  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index]!;
    if (quote) {
      if (ch === '\\') index += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) items += 1;
  }
  // A trailing comma (`(1,)`) does not start another item.
  return body.trimEnd().endsWith(',') ? items - 1 : items;
}

const PYTHON_VALUE_TYPES = new Set(['result', 'magic', 'watch', 'autoLog']);

/** Python cells: the editor's line results, read as answers. */
export function pythonAnswers(result: ExecutionResult, source: string): NotebookLineAnswerV1[] {
  return finalizeAnswers(
    toLineResults(result, source).map((row) =>
      row.type === 'error'
        ? answer(row.line, 'error', lastLine(row.value))
        : PYTHON_VALUE_TYPES.has(row.type)
          ? answer(row.line, 'value', row.value, pythonValueType(row.value))
          : answer(row.line, 'output', row.value)
    ),
    source
  );
}

/** A Python traceback ends with the line that names the error. */
function lastLine(message: string): string {
  const lines = message.trim().split('\n');
  return lines[lines.length - 1] ?? message;
}

const CREATE_RE =
  /^\s*create\s+(?:or\s+replace\s+)?(?:(?:temp|temporary)\s+)?(table|view)\s+(?:if\s+not\s+exists\s+)?((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))*)/i;

/** What a SQL cell's last statement was, and where its answer goes. */
export interface SqlAnswerTarget {
  /** Line of the last statement's first line. */
  readonly firstLine: number;
  /** Line of the last statement's last line. */
  readonly lastLine: number;
  /** `CREATE TABLE | VIEW <name>`: the name as written, and its display form. */
  readonly made?: { readonly kind: 'table' | 'view'; readonly name: string; readonly label: string };
  readonly isRead: boolean;
}

function newlines(text: string): number {
  return text.match(/\n/g)?.length ?? 0;
}

function leadingCommentsEnd(sql: string): number {
  let index = 0;
  while (index < sql.length) {
    if (/\s/.test(sql[index]!)) {
      index += 1;
      continue;
    }
    const isComment = sql.startsWith('--', index) || sql.startsWith('/*', index);
    const end = isComment ? skipSqlToken(sql, index) : -1;
    if (end === -1) break;
    index = end;
  }
  return index;
}

export function sqlAnswerTarget(source: string): SqlAnswerTarget | null {
  const statements = splitSqlStatements(source);
  const last = statements[statements.length - 1];
  if (!last) return null;
  // The statement text keeps the comments above it; answers skip them.
  const codeStart = leadingCommentsEnd(last.text);
  const text = last.text.slice(codeStart);
  const firstLine = last.startLine + newlines(last.text.slice(0, codeStart));
  const lastLine = firstLine + newlines(text);
  const code = sqlCodeOnly(text);
  const created = CREATE_RE.exec(text);
  // Only trust a CREATE seen in code, not one inside a string or comment.
  if (created && /^\s*create\b/i.test(code)) {
    const name = created[2]!.replace(/\s*\.\s*/g, '.');
    return {
      firstLine,
      lastLine,
      made: {
        kind: created[1]!.toLowerCase() as 'table' | 'view',
        name,
        label: name.replace(/"/g, ''),
      },
      isRead: false,
    };
  }
  return { firstLine, lastLine, isRead: isReadOnlySqlStatement(text) };
}

/** DuckDB reports a parse error position as `LINE n:` of the text it ran. */
export function sqlErrorLine(message: string, source: string): number {
  const match = /\bLINE (\d+):/.exec(message);
  const line = match ? Number(match[1]) : NaN;
  if (Number.isInteger(line) && line >= 1 && line <= lineCount(source)) return line;
  return sqlAnswerTarget(source)?.firstLine ?? getLastNonEmptyLine(source);
}
