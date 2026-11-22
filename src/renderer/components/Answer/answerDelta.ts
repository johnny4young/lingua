import { truncateText } from '../../../shared/truncateText';
import type { LineResult, RunAnswers } from '../../stores/resultStore';
import { readLiteral, type Literal } from './answerLiteral';
import { formatAnswerNumber } from './answerObjectModel';

/** How one line's answer moved since the previous run. */
export type AnswerChange =
  | { readonly kind: 'number'; readonly before: string; readonly up: boolean; readonly by: string }
  | { readonly kind: 'key'; readonly key: string; readonly up: boolean; readonly by: string }
  | { readonly kind: 'item'; readonly at: string; readonly before: string; readonly after: string }
  | { readonly kind: 'size'; readonly before: number; readonly after: number }
  | { readonly kind: 'text'; readonly before: string };

export interface AnswerDelta {
  readonly change: AnswerChange;
  /** The line's source differs between the two runs. */
  readonly edited: boolean;
}

const MAX_SHOWN = 24;

function shorten(text: string): string {
  return truncateText(text.trim().split('\n')[0] ?? '', MAX_SHOWN);
}

type Primitive = Extract<Literal, { t: 'num' | 'str' | 'bool' | 'none' }>;

function isPrimitive(value: Literal): value is Primitive {
  return value.t === 'num' || value.t === 'str' || value.t === 'bool' || value.t === 'none';
}

function shown(value: Primitive): string {
  if (value.t === 'num') return formatAnswerNumber(value.v, value.raw);
  if (value.t === 'str') return shorten(JSON.stringify(value.v));
  if (value.t === 'bool') return String(value.v);
  return value.raw;
}

function same(a: Literal, b: Literal): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function numberStep(before: number, after: number): { up: boolean; by: string } {
  return { up: after > before, by: formatAnswerNumber(Math.abs(after - before)) };
}

function literalChange(before: Literal, after: Literal): AnswerChange | null {
  if (before.t === 'num' && after.t === 'num') {
    if (before.v === after.v || !Number.isFinite(after.v - before.v)) return null;
    return { kind: 'number', before: formatAnswerNumber(before.v, before.raw), ...numberStep(before.v, after.v) };
  }
  if (before.t === 'list' && after.t === 'list') {
    if (before.items.length !== after.items.length) return { kind: 'size', before: before.items.length, after: after.items.length };
    const at = after.items.findIndex((item, index) => !same(item, before.items[index]!));
    if (at < 0) return null;
    const was = before.items[at]!;
    const now = after.items[at]!;
    return isPrimitive(was) && isPrimitive(now) ? { kind: 'item', at: `[${at}]`, before: shown(was), after: shown(now) } : null;
  }
  if (before.t === 'dict' && after.t === 'dict') {
    const old = new Map(before.entries.map(entry => [entry.key, entry.value]));
    if (old.size !== after.entries.length || after.entries.some(entry => !old.has(entry.key))) {
      return old.size === after.entries.length ? null : { kind: 'size', before: old.size, after: after.entries.length };
    }
    let widest: { key: string; before: number; after: number } | null = null;
    for (const { key, value } of after.entries) {
      const was = old.get(key)!;
      if (was.t !== 'num' || value.t !== 'num' || was.v === value.v) continue;
      if (!widest || Math.abs(value.v - was.v) > Math.abs(widest.after - widest.before)) widest = { key, before: was.v, after: value.v };
    }
    if (widest) return { kind: 'key', key: shorten(widest.key), ...numberStep(widest.before, widest.after) };
    const changed = after.entries.find(entry => !same(entry.value, old.get(entry.key)!));
    if (!changed) return null;
    const was = old.get(changed.key)!;
    return isPrimitive(was) && isPrimitive(changed.value)
      ? { kind: 'item', at: shorten(changed.key), before: shown(was), after: shown(changed.value) }
      : null;
  }
  return null;
}

/** The change between two printed values, or null when they read the same. */
export function answerChange(before: string, after: string): AnswerChange | null {
  if (before.trim() === after.trim()) return null;
  const was = readLiteral(before);
  const now = readLiteral(after);
  if (was && now) {
    if (same(was, now)) return null;
    const change = literalChange(was, now);
    if (change) return change;
  }
  return { kind: 'text', before: shorten(before) };
}

/** The answer a line compares by: its only answer, or the latest of a line that repeated one kind. */
function comparable(items: readonly LineResult[]): LineResult | null {
  const last = items[items.length - 1];
  if (!last || last.type === 'error') return null;
  if (items.length === 1) return last;
  return items.every(item => item.type === last.type && !item.name) ? last : null;
}

/** What changed on `line` between the previous run and the answers on screen. */
export function lineAnswerDelta(
  line: number,
  items: readonly LineResult[],
  previous: RunAnswers,
  latestSource: string | undefined
): AnswerDelta | null {
  const now = comparable(items);
  if (!now) return null;
  const was = comparable(previous.results.filter(result => result.line === line));
  if (!was || was.type !== now.type || was.name !== now.name) return null;
  const change = answerChange(String(was.value ?? ''), String(now.value ?? ''));
  if (!change) return null;
  const before = previous.sources[line];
  return { change, edited: before !== undefined && latestSource !== undefined && before !== latestSource };
}
