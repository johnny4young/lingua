/**
 * Column stats for the rail, computed from the rows already loaded (never a
 * second query): null share, distinct count, range, and either histogram bins
 * (numbers, dates) or the most frequent values.
 */

import type { SqlColumnMetadata } from '../../../shared/sqlWorkspace';
import { arrowTypeToDuckDb, isNumericSqlType } from '../../../shared/sqlTypeNames';

const BIN_COUNT = 8;
const TOP_COUNT = 5;
/** Past this many distinct values a column reports a lower bound and stops tracking new ones. */
export const DISTINCT_CAP = 10_000;
/** Cells the rail reads; a wider or longer result is summarized from its first rows. */
const CELL_BUDGET = 1_000_000;

export interface SqlHistogramBin {
  /** Inclusive bounds in the column's own scale (epoch ms for dates). */
  low: number;
  high: number;
  count: number;
}

export interface SqlColumnStats {
  name: string;
  duckType: string;
  kind: 'number' | 'date' | 'text';
  nullShare: number;
  distinct: number;
  /** More distinct values than {@link DISTINCT_CAP}; `distinct` is the cap. */
  distinctCapped: boolean;
  /** Smallest and largest value as shown; null when every value is null. */
  range: { low: string; high: string } | null;
  bins: SqlHistogramBin[];
  top: Array<{ value: string; count: number }>;
}

const isTemporal = (duckType: string) => /^(DATE|TIMESTAMP|TIME)/.test(duckType);

function numberOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const textOf = (value: unknown) =>
  typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);

function binsOf(values: number[]): SqlHistogramBin[] {
  if (values.length === 0) return [];
  let low = values[0]!;
  let high = values[0]!;
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  if (low === high) return [{ low, high, count: values.length }];
  const width = (high - low) / BIN_COUNT;
  const bins = Array.from({ length: BIN_COUNT }, (_, index) => ({
    low: low + index * width,
    high: index === BIN_COUNT - 1 ? high : low + (index + 1) * width,
    count: 0,
  }));
  for (const value of values) bins[Math.min(BIN_COUNT - 1, Math.floor((value - low) / width))]!.count += 1;
  return bins;
}

/** How many leading rows the rail summarizes for this many columns. */
export const statsRowLimit = (columnCount: number) => Math.max(1_000, Math.floor(CELL_BUDGET / Math.max(1, columnCount)));

export function columnStats(
  columns: ReadonlyArray<SqlColumnMetadata>,
  allRows: ReadonlyArray<Record<string, unknown>>
): SqlColumnStats[] {
  const limit = statsRowLimit(columns.length);
  const rows = allRows.length > limit ? allRows.slice(0, limit) : allRows;
  return columns.map((column) => {
    const duckType = arrowTypeToDuckDb(column.type);
    const kind: SqlColumnStats['kind'] = isNumericSqlType(duckType) ? 'number' : isTemporal(duckType) ? 'date' : 'text';
    let nulls = 0;
    let capped = false;
    const counts = new Map<string, number>();
    const scale: number[] = [];
    let low: string | null = null;
    let high: string | null = null;
    let lowNumber = Number.POSITIVE_INFINITY;
    let highNumber = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      const value = row[column.name];
      if (value === null || value === undefined) {
        nulls += 1;
        continue;
      }
      const text = typeof value === 'string' ? value : textOf(value);
      const seen = counts.get(text);
      if (seen !== undefined) counts.set(text, seen + 1);
      else if (counts.size < DISTINCT_CAP) counts.set(text, 1);
      else capped = true;
      if (kind === 'number') {
        const n = numberOf(value);
        if (n === null) continue;
        scale.push(n);
        if (n < lowNumber) {
          lowNumber = n;
          low = text;
        }
        if (n > highNumber) {
          highNumber = n;
          high = text;
        }
        continue;
      }
      if (kind === 'date') {
        const ms = Date.parse(text);
        if (Number.isFinite(ms)) scale.push(ms);
      }
      if (low === null || text < low) low = text;
      if (high === null || text > high) high = text;
    }
    const top =
      kind === 'text'
        ? [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, TOP_COUNT)
            .map(([value, count]) => ({ value, count }))
        : [];
    return {
      name: column.name,
      duckType,
      kind,
      nullShare: rows.length === 0 ? 0 : nulls / rows.length,
      distinct: counts.size,
      distinctCapped: capped,
      range: low !== null && high !== null ? { low, high } : null,
      bins: kind === 'text' ? [] : binsOf(scale),
      top,
    };
  });
}

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const sqlName = (name: string) => (SAFE_IDENTIFIER.test(name) ? name : `"${name.replaceAll('"', '""')}"`);
const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** The predicate a rail click inserts; the editor decides between WHERE and AND. */
export function equalsPredicate(stats: SqlColumnStats, value: string): string {
  return `${sqlName(stats.name)} = ${stats.kind === 'number' ? value : sqlText(value)}`;
}

function boundText(stats: SqlColumnStats, bound: number, edge: 'low' | 'high'): string {
  if (stats.kind === 'date') {
    const iso = new Date(bound).toISOString();
    return sqlText(stats.duckType === 'DATE' ? iso.slice(0, 10) : iso.replace('T', ' ').replace('Z', ''));
  }
  const integral = /INT/.test(stats.duckType);
  if (integral) return String(edge === 'low' ? Math.floor(bound) : Math.ceil(bound));
  return String(Number(bound.toPrecision(12)));
}

/** `col BETWEEN low AND high` over one bin or a run of bins. */
export function betweenPredicate(stats: SqlColumnStats, from: SqlHistogramBin, to: SqlHistogramBin): string {
  const low = Math.min(from.low, to.low);
  const high = Math.max(from.high, to.high);
  return `${sqlName(stats.name)} BETWEEN ${boundText(stats, low, 'low')} AND ${boundText(stats, high, 'high')}`;
}
