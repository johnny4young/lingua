import { parseColorToRgb } from '../../utils/developerUtilityDetection';

/**
 * The CSS colour a string names: hex, rgb() or hsl() with channels in range,
 * as the developer utilities read them. The grammar is strict, so the returned
 * text is safe to hand to an inline style.
 */
export function detectColour(text: string): string | null {
  if (text.length > 64) return null;
  const value = text.trim();
  return parseColorToRgb(value) ? value : null;
}

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)`;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Epoch ms for an ISO-8601 date or date-time string, or null. */
export function detectIsoDate(text: string): number | null {
  if (text.length > 40) return null;
  const value = text.trim();
  if (!ISO_DATE.test(value)) return null;
  // Date.parse reads a bare date as UTC midnight, which is the previous day west of UTC.
  if (value.length === 10) {
    const [y, m, d] = value.split('-').map(Number);
    const local = new Date(y!, m! - 1, d!);
    return local.getMonth() === m! - 1 ? local.getTime() : null;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

export interface Gauge {
  readonly threshold: number;
  /** The quantity compared with the threshold, recovered from the answer. */
  readonly measured: number;
  readonly over: boolean;
}

/** Drops a trailing `//` or `#` comment that is not inside a string. */
function stripComment(source: string): string {
  let quote: string | null = null;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]!;
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '#' || (c === '/' && source[i + 1] === '/')) return source.slice(0, i);
  }
  return source;
}

const NUMBER_ONLY = new RegExp(String.raw`^${NUM}$`);
// `items.length - 1` or `len(xs) - 1` is an index, not a budget.
const COUNT_TERM = /(?:\.length|\.size|\bsize|\bcount|\blen\(.*\))$/i;

/** True when an operand is one non-literal term: no top-level arithmetic (brackets and calls are fine). */
function isSingleTerm(operand: string): boolean {
  if (NUMBER_ONLY.test(operand)) return false;
  let depth = 0;
  for (let i = 0; i < operand.length; i += 1) {
    const c = operand[i]!;
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (depth === 0 && '+-*/%<>=!&|?:'.includes(c) && i > 0) return false;
  }
  return depth === 0 && operand.length > 0;
}

/**
 * A number answered against a threshold written in the statement: `120 - p95`
 * is headroom under 120, `latency - 120` is the excess over it.
 */
export function detectGauge(source: string, value: number): Gauge | null {
  if (!Number.isFinite(value)) return null;
  const code = stripComment(source).trim().replace(/;$/, '');
  // The right-hand side of an assignment, or the bare expression.
  const assignment = /^(?:(?:const|let|var|final)\s+)?[\w$.[\]'"]+\s*(?::[^=]+)?=(?!=)\s*(.+)$/.exec(code);
  const expression = (assignment?.[1] ?? code).trim();
  const lead = new RegExp(String.raw`^(${NUM})\s*-\s*(.+)$`).exec(expression);
  if (lead && isSingleTerm(lead[2]!.trim())) {
    const threshold = Number(lead[1]);
    if (threshold <= 1) return null;
    const measured = threshold - value;
    return { threshold, measured, over: measured > threshold };
  }
  const trail = new RegExp(String.raw`^(.+?)\s*-\s*(${NUM})$`).exec(expression);
  if (trail && isSingleTerm(trail[1]!.trim()) && !COUNT_TERM.test(trail[1]!.trim())) {
    const threshold = Number(trail[2]);
    if (threshold <= 1) return null;
    const measured = value + threshold;
    return { threshold, measured, over: measured > threshold };
  }
  return null;
}
