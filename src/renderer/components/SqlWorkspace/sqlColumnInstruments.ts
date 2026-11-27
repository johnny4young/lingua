/**
 * Instruments the result grid draws from the loaded rows: which numeric
 * columns get a 0–1 fraction bar or a scale bar, and the Σ row's sum or average.
 */

import { coerceSupportedLanguage } from '../../../shared/i18n/languages';
import type { SqlColumnMetadata } from '../../../shared/sqlWorkspace';
import { arrowTypeToDuckDb, isNumericSqlType } from '../../../shared/sqlTypeNames';
import { toWords } from '../../utils/stringCase';
import { numberOf } from './sqlColumnStats';
import { DELETED, type ShownRow } from './sqlRowEditModel';

export interface SqlColumnSummary {
  kind: 'sum' | 'avg';
  value: number;
  /** Decimal places the column's values carry, capped, so a sum of cents keeps its cents. */
  digits: number;
}

export interface SqlResultInstruments {
  /**
   * Numeric columns drawn as 0–1 bars: every value is a JS number from 0 to 1
   * and at least one has a fraction, so a column of 0s and 1s stays numbers.
   */
  fractions: ReadonlySet<string>;
  /** Each scale-barred column's largest value. */
  scales: ReadonlyMap<string, number>;
  summaries: ReadonlyMap<string, SqlColumnSummary>;
  /** Where Σ and the row count sit: the first column without a sum, else the first column. */
  labelColumn: string | null;
  /** Rows summarized, without staged deletions. */
  rowCount: number;
  /** Live rows past the cell budget, left out of everything above. */
  skipped: number;
}

const MAX_DIGITS = 4;
const AVERAGE_WORDS = new Set(['avg', 'average', 'mean', 'median', 'rate', 'ratio', 'pct', 'percent', 'percentage', 'share']);

const nameWords = (name: string) => toWords(name).map((word) => word.toLowerCase());

/** Keys measure nothing: a bar or a sum of ids reads as data it is not. */
export function isIdentifierColumn(name: string): boolean {
  return nameWords(name).at(-1) === 'id';
}

/** Keys and years read as labels, so a numeric column by these names keeps its raw digits on screen. */
export function groupsDigits(name: string): boolean {
  const last = nameWords(name).at(-1);
  return last !== 'id' && last !== 'year';
}

const isAverageColumn = (name: string) => nameWords(name).some((word) => AVERAGE_WORDS.has(word));

function decimalsOf(raw: unknown, value: number): number {
  if (typeof raw === 'number') {
    if (Number.isInteger(value)) return 0;
    raw = String(raw);
  }
  if (typeof raw !== 'string') return 0;
  if (raw.includes('e') || raw.includes('E')) return MAX_DIGITS;
  const dot = raw.indexOf('.');
  return dot < 0 ? 0 : Math.min(MAX_DIGITS, raw.length - dot - 1);
}

interface Tally {
  name: string;
  /** A key by name: no bar, no sum. */
  key: boolean;
  min: number;
  max: number;
  sum: number;
  count: number;
  digits: number;
  /** Every value so far is a JS number in 0–1. */
  unit: boolean;
  fractional: boolean;
}

/**
 * One pass over the rows in load order, within `rowLimit`. A numeric column
 * with two or more values, none negative, gets a scale bar unless it is a
 * fraction; every numeric column gets a sum, or an average for ratios by name
 * and fractions. Keys and foreign keys get neither.
 */
export function resultInstruments(
  columns: ReadonlyArray<SqlColumnMetadata>,
  rows: ReadonlyArray<Record<string, unknown>>,
  foreignKeys: ReadonlySet<string>,
  rowLimit: number
): SqlResultInstruments {
  const open = columns
    .filter((column) => isNumericSqlType(arrowTypeToDuckDb(column.type)))
    .map(({ name }): Tally => ({
      name,
      key: isIdentifierColumn(name),
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      sum: 0,
      count: 0,
      digits: 0,
      unit: true,
      fractional: false,
    }));
  let rowCount = 0;
  let skipped = 0;
  // Row by row: rows are hash tables scattered over the heap, so a column at a time misses the cache on every cell.
  for (const row of rows) {
    if ((row as ShownRow)[DELETED] === true) continue;
    if (rowCount >= rowLimit) {
      skipped += 1;
      continue;
    }
    rowCount += 1;
    for (const column of open) {
      const raw = row[column.name];
      if (raw === null || raw === undefined) continue;
      const value = numberOf(raw);
      if (value === null) {
        column.unit = false;
        continue;
      }
      if (typeof raw !== 'number' || value < 0 || value > 1) column.unit = false;
      else if (!Number.isInteger(value)) column.fractional = true;
      if (value < column.min) column.min = value;
      if (value > column.max) column.max = value;
      column.sum += value;
      column.count += 1;
      if (column.digits < MAX_DIGITS) column.digits = Math.max(column.digits, decimalsOf(raw, value));
    }
  }
  const fractions = new Set<string>();
  const scales = new Map<string, number>();
  const summaries = new Map<string, SqlColumnSummary>();
  for (const column of open) {
    if (column.count === 0) continue;
    const fraction = column.unit && column.fractional;
    if (fraction) fractions.add(column.name);
    if (column.key || foreignKeys.has(column.name)) continue;
    if (!fraction && column.count >= 2 && column.min >= 0 && column.max > column.min) {
      scales.set(column.name, column.max);
    }
    const average = fraction || isAverageColumn(column.name);
    // Past 2^53 an integer sum is no longer exact; no Σ beats a wrong one.
    if (!average && column.digits === 0 && !Number.isSafeInteger(column.sum)) continue;
    summaries.set(
      column.name,
      average
        ? { kind: 'avg', value: column.sum / column.count, digits: Math.max(2, column.digits) }
        : { kind: 'sum', value: column.sum, digits: column.digits }
    );
  }
  const labelColumn = (columns.find(({ name }) => !summaries.has(name)) ?? columns[0])?.name ?? null;
  return { fractions, scales, summaries, labelColumn, rowCount, skipped };
}

/** The bar's share of its column's largest value, 0–1; null draws no bar. */
export function barShare(value: unknown, max: number | undefined): number | null {
  if (max === undefined) return null;
  const n = numberOf(value);
  return n === null || n < 0 ? null : Math.min(1, n / max);
}

const summaryFormats = new Map<string, Intl.NumberFormat>();

/** A Σ value in the app locale, at the column's own precision. */
export function formatSummary(summary: SqlColumnSummary, language: string): string {
  const locale = coerceSupportedLanguage(language);
  const key = `${locale}:${summary.digits}`;
  let format = summaryFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { minimumFractionDigits: summary.digits, maximumFractionDigits: summary.digits });
    summaryFormats.set(key, format);
  }
  return format.format(summary.value);
}
