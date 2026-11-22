import type { NotebookCellLanguage, NotebookLineAnswerV1 } from '../../../shared/notebook';
import type { ScopeValue } from '../../../shared/scopeSnapshot';
import { KEY_COLUMN } from '../../utils/lastAnswer';
import { scopeValueToString } from '../Console/richConsoleFormat';

/** Line height of a code cell, shared by the code and its answer column. */
export function notebookLineHeight(fontSize: number): number {
  return Math.max(22, Math.round(fontSize * 1.6));
}

/** Where a line's text ends, in characters, with tabs at the cell's tab size. */
export function lineLength(line: string): number {
  return line.replace(/\t/g, '  ').trimEnd().length;
}

export type AnswerTone = 'number' | 'string' | 'boolean' | 'nil' | 'error' | 'text';

const NUMBER_TYPES = new Set(['number', 'int', 'float', 'bigint', 'rows', 'decimal']);
const STRING_TYPES = new Set(['string', 'str', 'bytes', 'date']);
const BOOLEAN_TYPES = new Set(['boolean', 'bool']);
const NIL_TYPES = new Set(['null', 'undefined', 'None']);

export function answerTone(answer: NotebookLineAnswerV1): AnswerTone {
  if (answer.kind === 'error') return 'error';
  if (answer.kind !== 'value' || answer.type === undefined) return 'text';
  if (NUMBER_TYPES.has(answer.type)) return 'number';
  if (STRING_TYPES.has(answer.type)) return 'string';
  if (BOOLEAN_TYPES.has(answer.type)) return 'boolean';
  if (NIL_TYPES.has(answer.type)) return 'nil';
  return 'text';
}

/** The tag before an answer: its type (with a length), or what kind of line it is. */
export function answerTag(answer: NotebookLineAnswerV1, language: NotebookCellLanguage): string {
  switch (answer.kind) {
    case 'table':
    case 'result':
      return 'table';
    case 'error':
      return 'error';
    case 'output':
      return language === 'python' ? 'print' : 'log';
    case 'value':
      if (answer.type === undefined) return 'value';
      return answer.size === undefined ? answer.type : `${answer.type}·${answer.size}`;
  }
}

const KIND_RANK: Record<NotebookLineAnswerV1['kind'], number> = {
  error: 0,
  table: 1,
  result: 1,
  value: 2,
  output: 3,
};

/** One answer per line: an error first, then a table, a value, a printed line. */
export function answersByLine(
  answers: ReadonlyArray<NotebookLineAnswerV1>
): NotebookLineAnswerV1[] {
  const best = new Map<number, NotebookLineAnswerV1>();
  for (const answer of answers) {
    const current = best.get(answer.line);
    if (!current || KIND_RANK[answer.kind] < KIND_RANK[current.kind]) best.set(answer.line, answer);
  }
  return [...best.values()].sort((a, b) => a.line - b.line);
}

/** A numeric list answer as its range and bar heights (0–100); null otherwise. */
export function numericSeries(answer: NotebookLineAnswerV1): { range: string; bars: number[] } | null {
  if (answer.kind !== 'value' || !['list', 'array', 'tuple'].includes(answer.type ?? '')) return null;
  const text = answer.text.trim();
  const body = text.startsWith('(') && text.endsWith(')') ? `[${text.slice(1, -1).replace(/,\s*$/, '')}]` : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length < 2) return null;
  if (!parsed.every((item) => typeof item === 'number' && Number.isFinite(item))) return null;
  const values = parsed as number[];
  // Ten significant digits keep the value as written and drop float noise.
  const show = (value: number) => String(Number(value.toPrecision(10)));
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { range: `${show(min)} – ${show(max)}`, bars: rangeBars(values, min, max) };
}

const MAX_BARS = 12;

/**
 * Bar heights 25–100 across the series' own range, evenly sampled to twelve.
 * Start's bars grow from zero; a value range like 130–171 would read flat.
 */
function rangeBars(values: readonly number[], min: number, max: number): number[] {
  const step = Math.max(1, values.length / MAX_BARS);
  const bars: number[] = [];
  for (let index = 0; index < values.length && bars.length < MAX_BARS; index += step) {
    const value = values[Math.floor(index)]!;
    bars.push(max === min ? 50 : 25 + (75 * (value - min)) / (max - min));
  }
  return bars;
}

export interface AnswerGrid {
  readonly cells: ReadonlyArray<ReadonlyArray<{ readonly text: string; readonly numeric: boolean }>>;
  /** Column drawn with bars, or -1; widths are 0–100 of that column's maximum. */
  readonly barColumn: number;
  readonly barWidths: ReadonlyArray<number>;
}

/**
 * A result table as display cells, plus the column that carries bars: the
 * last measurable one (non-negative numbers, not all equal, not a key).
 */
export function answerGrid(columns: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<ScopeValue>>): AnswerGrid {
  const cells = rows.map((row) => columns.map((_, index) => tableCell(row[index])));
  for (let column = columns.length - 1; column >= 0; column -= 1) {
    if (KEY_COLUMN.test(columns[column]!) || cells.length < 2) continue;
    if (!cells.every((row) => row[column]!.numeric)) continue;
    const numbers = cells.map((row) => Number(row[column]!.text));
    let max = 0;
    let min = Infinity;
    for (const value of numbers) {
      max = Math.max(max, value);
      min = Math.min(min, value);
    }
    if (min < 0 || max === min) continue;
    return { cells, barColumn: column, barWidths: numbers.map((value) => (value / max) * 100) };
  }
  return { cells, barColumn: -1, barWidths: [] };
}

function tableCell(value: ScopeValue | undefined): { text: string; numeric: boolean } {
  if (!value) return { text: '', numeric: false };
  if (value.kind !== 'primitive') return { text: scopeValueToString(value), numeric: false };
  if (value.type === 'number') return { text: value.repr, numeric: true };
  if (value.type === 'string') {
    let text = value.repr;
    try {
      const parsed: unknown = JSON.parse(value.repr);
      if (typeof parsed === 'string') text = parsed;
    } catch {
      // Keep the repr as it came.
    }
    return { text, numeric: /^-?\d+(\.\d+)?$/.test(text) };
  }
  return { text: value.repr, numeric: false };
}
