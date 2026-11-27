import type { NotebookCellLanguage, NotebookLineAnswerV1 } from '../../../shared/notebook';
import type { RichOutputPayload } from '../../../shared/richOutput';
import { serializeScopeValue, type ScopeValue } from '../../../shared/scopeSnapshot';
import { KEY_COLUMN } from '../../utils/lastAnswer';
import { scopeValueToString } from '../Console/richConsoleFormat';
import { groupsDigits } from '../SqlWorkspace/sqlColumnInstruments';
import { renderNumberCell } from '../SqlWorkspace/sqlResultFormatters';
import type { AnswerInput } from '../Answer/answerObjectModel';

/** Line height of a code cell, shared by the code and its answer column. */
export function notebookLineHeight(fontSize: number): number {
  return Math.max(22, Math.round(fontSize * 1.6));
}

/** Where a line's text ends, in characters, with tabs at the cell's tab size. */
export function lineLength(line: string): number {
  return line.replace(/\t/g, '  ').trimEnd().length;
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

const CUT = '…';
const COLLECTION_TYPES = new Set(['array', 'object', 'list', 'tuple', 'dict', 'set', 'map']);
const SCRIPT_PRIMITIVES = new Set(['number', 'bigint', 'symbol', 'boolean']);

/**
 * A stored line answer as the shared answer renderer reads it. Kernels store
 * text capped to a few hundred characters, so a cut value reads as its head.
 */
export function notebookAnswerInput(
  answer: NotebookLineAnswerV1,
  language: NotebookCellLanguage,
  source?: string
): AnswerInput {
  const base = { language, ...(source ? { source } : {}) };
  if (answer.kind === 'error') return { ...base, text: answer.text, role: 'error' };
  if (answer.kind === 'output') return { ...base, text: answer.text, role: 'stdout' };
  const { text, type } = answer;
  const cut = text.endsWith(CUT);
  if (type === 'string' || type === 'str') {
    // A cut string lost its closing quote; read it as a clamped repr.
    return cut ? { ...base, text, payload: { kind: 'primitive', type: 'string', repr: `"${text.slice(1)}` } } : { ...base, text };
  }
  if (cut && type !== undefined && COLLECTION_TYPES.has(type)) return { ...base, text, length: text.length + 1 };
  if (language === 'python' || type === undefined) return { ...base, text };
  if (SCRIPT_PRIMITIVES.has(type)) return { ...base, text, payload: { kind: 'primitive', type: type as 'number', repr: text } };
  if (type === 'function') return { ...base, text, payload: { kind: 'function', name: text.replace(/^ƒ /, '') } };
  if (type === 'promise') return { ...base, text, payload: { kind: 'promise', state: 'pending' } };
  if (type === 'map' || type === 'set') {
    const payload = collectionPayload(type, text, answer.size);
    if (payload) return { ...base, text, payload };
  }
  return { ...base, text };
}

const SCOPE_OPTIONS = { truncate: (text: string) => `${text}${CUT}`, maxDepth: 2 };

function collectionPayload(type: 'map' | 'set', text: string, size: number | undefined): RichOutputPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const count = size ?? parsed.length;
  if (type === 'set') return { kind: 'set', size: count, entries: parsed.map((item) => serializeScopeValue(item, SCOPE_OPTIONS)) };
  if (!parsed.every((entry) => Array.isArray(entry) && entry.length === 2)) return null;
  const entries = (parsed as unknown[][]).map(([key, value]) => ({
    key: serializeScopeValue(key, SCOPE_OPTIONS),
    value: serializeScopeValue(value, SCOPE_OPTIONS),
  }));
  return { kind: 'map', size: count, entries };
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
 * Numbers group their digits in `language`, except keys and years.
 */
export function answerGrid(
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<ScopeValue>>,
  language: string
): AnswerGrid {
  const grouped = columns.map(groupsDigits);
  const values: number[][] = [];
  const cells = rows.map((row) => {
    const numbers: number[] = [];
    values.push(numbers);
    return columns.map((_, index) => {
      const cell = tableCell(row[index]);
      if (!cell.numeric) return cell;
      const value = Number(cell.text);
      numbers[index] = value;
      // Leading zeros mark a code (zip, account), not a quantity.
      if (!grouped[index] || /^-?0\d/.test(cell.text)) return cell;
      // A written integer takes the formatter's cached fast path; decimals keep every digit as written.
      const integer = Number.isSafeInteger(value) && !Object.is(value, -0) && /^-?\d+$/.test(cell.text);
      return { ...cell, text: renderNumberCell(integer ? value : cell.text, language) };
    });
  });
  for (let column = columns.length - 1; column >= 0; column -= 1) {
    if (KEY_COLUMN.test(columns[column]!) || cells.length < 2) continue;
    if (!cells.every((row) => row[column]!.numeric)) continue;
    const numbers = values.map((row) => row[column]!);
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
