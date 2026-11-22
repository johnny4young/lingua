/**
 * How the response tree answers a value: primitives read with the answer
 * grammar (tone, pill, colour swatch, relative date), and an array of
 * objects reads as a table with bars on its measurable columns.
 */

import { detectColour, detectIsoDate } from '../Answer/answerDetectors';
import { answerDateText, type AnswerContext } from '../Answer/answerObjectModel';
import { measurableMax } from '../../utils/lastAnswer';
import { isContainer } from './httpJsonTreeModel';

type JsonTone = 'number' | 'string' | 'boolean' | 'none' | 'date';

export interface JsonLeafReading {
  readonly tone: JsonTone;
  /** Scalars sit in a tinted pill; plain strings do not. */
  readonly pill: boolean;
  /** CSS colour the string names, drawn as a swatch. */
  readonly swatch?: string;
  /** A date's weekday, time and how long ago. */
  readonly note?: string;
}

export function readJsonLeaf(value: unknown, context: AnswerContext): JsonLeafReading {
  if (typeof value === 'number') return { tone: 'number', pill: true };
  if (typeof value === 'boolean') return { tone: 'boolean', pill: true };
  if (typeof value !== 'string') return { tone: 'none', pill: true };
  const swatch = detectColour(value);
  if (swatch) return { tone: 'string', pill: false, swatch };
  const time = detectIsoDate(value);
  if (time === null) return { tone: 'string', pill: false };
  const { value: day, relative } = answerDateText(time, context);
  return { tone: 'date', pill: true, note: `${day} · ${relative}` };
}

/** Wider tables stay a tree: a table that hides columns would hide values. */
const TABLE_MAX_COLUMNS = 8;

export interface JsonTableShape {
  readonly columns: readonly string[];
  /** Column → its largest value, for the columns whose bars mean magnitude. */
  readonly scales: ReadonlyMap<string, number>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => isContainer(value) && !Array.isArray(value);

// A parsed body never changes, so each array is read once however often the tree renders.
const shapes = new WeakMap<readonly unknown[], JsonTableShape | null>();

/**
 * The table an array of objects reads as, or null: it needs two or more
 * non-empty objects sharing at most {@link TABLE_MAX_COLUMNS} keys.
 */
export function objectTable(node: readonly unknown[]): JsonTableShape | null {
  const cached = shapes.get(node);
  if (cached !== undefined) return cached;
  const shape = readTable(node);
  shapes.set(node, shape);
  return shape;
}

function readTable(node: readonly unknown[]): JsonTableShape | null {
  if (node.length < 2) return null;
  const columns = new Set<string>();
  for (const item of node) {
    if (!isRecord(item)) return null;
    const keys = Object.keys(item);
    if (keys.length === 0) return null;
    for (const key of keys) columns.add(key);
    if (columns.size > TABLE_MAX_COLUMNS) return null;
  }
  const scales = new Map<string, number>();
  for (const column of columns) {
    const max = measurableMax(column, node.map((item) => (item as Record<string, unknown>)[column]));
    if (max !== undefined) scales.set(column, max);
  }
  return { columns: [...columns], scales };
}

/** A nested value in a table cell: its size, opened from the tree view. */
export function containerSummary(value: Record<string, unknown> | unknown[]): string {
  return Array.isArray(value) ? `[…${value.length}]` : `{…${Object.keys(value).length}}`;
}
