/**
 * Grid filters, sort and column layout over the loaded rows, plus the SQL
 * that does the same in DuckDB, shown under the grid with Apply to query.
 */

import { splitSqlStatements } from '../../../shared/sqlStatements';
import type { SqlColumnMetadata } from '../../../shared/sqlWorkspace';
import { arrowTypeToDuckDb, isNumericSqlType } from '../../../shared/sqlTypeNames';
import { quoteSqlIdentifier } from './sqlResultFormatters';
import type { SqlSortState } from './sqlResultGrid';

export type SqlFilterOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'is-null' | 'not-null';

export const SQL_FILTER_OPS: ReadonlyArray<SqlFilterOp> = ['=', '!=', '>', '>=', '<', '<=', 'contains', 'is-null', 'not-null'];

export const opTakesValue = (op: SqlFilterOp) => op !== 'is-null' && op !== 'not-null';

export interface SqlFilterCondition {
  id: string;
  column: string;
  op: SqlFilterOp;
  value: string;
}

/** Column order and the hidden ones; columns a new result adds are appended visible. */
export interface SqlColumnLayout {
  order: ReadonlyArray<string>;
  hidden: ReadonlyArray<string>;
}

type Row = Record<string, unknown>;

function cellString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function matches(value: unknown, condition: SqlFilterCondition, numeric: boolean): boolean {
  const isNull = value === null || value === undefined;
  if (condition.op === 'is-null') return isNull;
  if (condition.op === 'not-null') return !isNull;
  if (isNull) return false;
  if (condition.op === 'contains') {
    return cellString(value).toLowerCase().includes(condition.value.toLowerCase());
  }
  const left = numeric ? asNumber(value) : null;
  const right = numeric ? asNumber(condition.value) : null;
  const cmp =
    left !== null && right !== null
      ? Math.sign(left - right)
      : cellString(value).localeCompare(condition.value, undefined, { numeric: true });
  switch (condition.op) {
    case '=':
      return cmp === 0;
    case '!=':
      return cmp !== 0;
    case '>':
      return cmp > 0;
    case '>=':
      return cmp >= 0;
    case '<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
  }
}

const numericColumns = (columns: ReadonlyArray<SqlColumnMetadata>) =>
  new Set(columns.filter((column) => isNumericSqlType(arrowTypeToDuckDb(column.type))).map((column) => column.name));

/** Rows that pass every condition on a column the result still has. */
export function applyConditions<T extends Row>(
  rows: ReadonlyArray<T>,
  conditions: ReadonlyArray<SqlFilterCondition>,
  columns: ReadonlyArray<SqlColumnMetadata>
): T[] {
  const names = new Set(columns.map((column) => column.name));
  const live = conditions.filter((condition) => names.has(condition.column));
  if (live.length === 0) return [...rows];
  const numeric = numericColumns(columns);
  return rows.filter((row) => live.every((condition) => matches(row[condition.column], condition, numeric.has(condition.column))));
}

/** The visible columns in layout order. */
export function visibleColumns(
  columns: ReadonlyArray<SqlColumnMetadata>,
  layout: SqlColumnLayout
): SqlColumnMetadata[] {
  const byName = new Map(columns.map((column) => [column.name, column]));
  const ordered = [
    ...layout.order.filter((name) => byName.has(name)),
    ...columns.map((column) => column.name).filter((name) => !layout.order.includes(name)),
  ];
  return ordered.filter((name) => !layout.hidden.includes(name)).map((name) => byName.get(name)!);
}

const sqlLiteral = (value: string, numeric: boolean) =>
  numeric && asNumber(value) !== null ? String(asNumber(value)) : `'${value.replaceAll("'", "''")}'`;

function conditionSql(condition: SqlFilterCondition, numeric: boolean): string {
  const column = quoteSqlIdentifier(condition.column);
  switch (condition.op) {
    case 'is-null':
      return `${column} IS NULL`;
    case 'not-null':
      return `${column} IS NOT NULL`;
    case 'contains':
      return `CAST(${column} AS VARCHAR) ILIKE '%${condition.value.replaceAll("'", "''").replace(/[%_\\]/g, '\\$&')}%' ESCAPE '\\'`;
    default:
      return `${column} ${condition.op === '!=' ? '<>' : condition.op} ${sqlLiteral(condition.value, numeric)}`;
  }
}

/**
 * The query as a subquery with the grid's filters, sort and columns, or null
 * when the grid adds nothing to it. The free-text search has no SQL form, so
 * it is left out.
 */
export function buildGridSql(
  baseSql: string,
  conditions: ReadonlyArray<SqlFilterCondition>,
  sort: SqlSortState,
  columns: ReadonlyArray<SqlColumnMetadata>,
  layout: SqlColumnLayout
): string | null {
  const names = new Set(columns.map((column) => column.name));
  const live = conditions.filter((condition) => names.has(condition.column));
  const shown = visibleColumns(columns, layout);
  const reshaped =
    shown.length !== columns.length || shown.some((column, index) => column.name !== columns[index]?.name);
  const sorted = sort.column !== null && names.has(sort.column);
  if (live.length === 0 && !sorted && !reshaped) return null;
  const numeric = numericColumns(columns);
  const select = reshaped ? shown.map((column) => quoteSqlIdentifier(column.name)).join(', ') : '*';
  // Without its semicolon or a trailing comment, which would end the subquery early.
  const body = splitSqlStatements(baseSql)[0]?.text ?? baseSql.trim();
  const parts = [`SELECT ${select}\nFROM (\n${body}\n) AS result`];
  if (live.length > 0) {
    parts.push(`WHERE ${live.map((condition) => conditionSql(condition, numeric.has(condition.column))).join('\n  AND ')}`);
  }
  if (sorted) parts.push(`ORDER BY ${quoteSqlIdentifier(sort.column!)} ${sort.direction === 'asc' ? 'ASC' : 'DESC'}`);
  return parts.join('\n');
}

/** Fixed-height row window: what to mount and the spacer heights around it. */
export function fixedRowWindow(params: {
  count: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan: number;
}): { start: number; end: number; top: number; bottom: number } {
  const { count, rowHeight, scrollTop, viewportHeight, overscan } = params;
  if (count === 0) return { start: 0, end: -1, top: 0, bottom: 0 };
  // Without a measured viewport (jsdom, first paint) mount a screenful.
  const height = viewportHeight > 0 ? viewportHeight : rowHeight * 40;
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(count - 1, first + Math.ceil(height / rowHeight) + overscan);
  return { start, end, top: start * rowHeight, bottom: (count - 1 - end) * rowHeight };
}
