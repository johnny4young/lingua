/**
 * Staged row edits on one table: the change set the grid builds, the checks
 * main and the renderer both run on it, and the SQL it becomes. Every
 * statement touches one row found by its whole primary key (or DuckDB's
 * rowid), and they all run in one transaction.
 */

import type { SqlEngineKind } from './sqlConnections';
import { sqlDialect } from './sqlDialect';

/** How a row is found: its whole primary key, or DuckDB's rowid for a Local table without one. */
type RowEditKey = { kind: 'pk'; columns: string[] } | { kind: 'rowid' };

export interface RowEditTable {
  engine: SqlEngineKind;
  schema?: string;
  name: string;
  /** The table's columns; only these can be set. */
  columns: string[];
  /** Declared types by column, as the engine reports them. */
  types?: Record<string, string>;
  key: RowEditKey;
}

/** A cell as typed: text the engine converts to the column's type, or null for SQL NULL. */
export type RowEditValue = string | null;

type Values = Record<string, RowEditValue>;

export interface RowEditChanges {
  /** The key values that find each row, and its new values by column. `original` holds what was read, so a row changed since then is a conflict. */
  updates: Array<{ key: Values; values: Values; original?: Values }>;
  deletes: Array<{ key: Values; original?: Values }>;
  /** New rows; a column left out takes its default. */
  inserts: Array<{ values: Values }>;
}

/** Why an edit transaction rolled back, for the renderer to say in the user's language. */
export type RowEditFailure = { kind: 'conflict'; change: number; touched: number } | { kind: 'too-slow' };

export interface RowEditStatement {
  sql: string;
  /** Bound in order; empty when the values are written into `sql`. */
  params: RowEditValue[];
}

const MAX_ROW_EDITS = 1000;
const MAX_VALUE_LENGTH = 1024 * 1024;
/** Characters across every name and value of one change set. */
const MAX_CHANGE_SET_LENGTH = 16 * 1024 * 1024;

/** How long one edit transaction may run in the SQL host; main waits twice that. */
export const ROW_EDIT_BUDGET_MS = 60_000;

const ROWID = 'rowid';

/** Engines whose tables take staged edits: each statement runs in a transaction and reports the rows it touched. */
export const ROW_EDIT_ENGINES: ReadonlySet<SqlEngineKind> = new Set(['duckdb', 'postgres', 'mysql', 'sqlite', 'sqlserver', 'libsql', 'neon']);

type ColumnKind = 'text' | 'integer' | 'decimal' | 'boolean' | 'float' | 'temporal' | 'binary' | 'other';

const COLUMN_KINDS: Array<[ColumnKind, RegExp]> = [
  ['text', /^(?:n?varchar|n?char|character|bpchar|n?text|tinytext|mediumtext|longtext|citext|string|clob|uuid|uniqueidentifier|enum|set)$/],
  ['integer', /^(?:tinyint|smallint|mediumint|int\d?|integer|bigint|hugeint|uhugeint|utinyint|usmallint|uinteger|ubigint|(?:small|big)?serial)$/],
  ['decimal', /^(?:numeric|decimal|dec)$/],
  ['boolean', /^bool(?:ean)?$/],
  ['float', /^(?:float\d?|double|real|money|smallmoney)$/],
  ['temporal', /^(?:date|time|timetz|timestamp\w*|datetime\d?|datetimeoffset|smalldatetime|interval|year)$/],
  ['binary', /^(?:bytea|blob|tinyblob|mediumblob|longblob|binary|varbinary|image)$/],
];

function columnKind(table: Pick<RowEditTable, 'engine' | 'types'>, column: string): ColumnKind {
  const name = (table.types?.[column] ?? '').trim().toLowerCase().split(/[\s(]/)[0] ?? '';
  if (name === 'bit' && table.engine === 'mysql') return 'binary';
  return COLUMN_KINDS.find(([, pattern]) => pattern.test(name))?.[0] ?? 'other';
}

/** Whether the grid's text is the stored value: binaries arrive as base64, and some drivers round or cut decimals and times. */
export function cellTextIsExact(table: Pick<RowEditTable, 'engine' | 'types'>, column: string): boolean {
  const kind = columnKind(table, column);
  if (kind === 'binary' || kind === 'float') return false;
  if (kind === 'decimal') return table.engine !== 'sqlserver';
  if (kind === 'temporal') return table.engine === 'mysql' || table.engine === 'sqlite' || table.engine === 'libsql';
  return true;
}

export const isBinaryColumn = (table: Pick<RowEditTable, 'engine' | 'types'>, column: string) => columnKind(table, column) === 'binary';

/** A number, date or boolean has no empty value, and some engines would store 0 or 1900-01-01 for one. */
export function takesEmptyText(table: Pick<RowEditTable, 'engine' | 'types'>, column: string): boolean {
  const kind = columnKind(table, column);
  return kind === 'text' || kind === 'other';
}

/** Longer values are not compared, so a change set stays within its caps. */
const MAX_COMPARED_LENGTH = 4096;

/** Whether `column = text` finds this value on every engine; other types, such as dates and floats, are not compared. */
function comparesExactly(table: Pick<RowEditTable, 'engine' | 'types'>, column: string): boolean {
  const kind = columnKind(table, column);
  if (kind !== 'text' && kind !== 'integer' && kind !== 'decimal' && kind !== 'boolean') return false;
  // SQL Server has no = for its legacy large text types.
  if (table.engine === 'sqlserver' && /^n?text\b/i.test(table.types?.[column] ?? '')) return false;
  return cellTextIsExact(table, column);
}

/** What a commit checks is still there, from the row as read. */
export function rowEditOriginal(table: RowEditTable, columns: readonly string[], cell: (column: string) => RowEditValue): Values {
  const original: Values = {};
  for (const column of columns) {
    if (!comparesExactly(table, column)) continue;
    const value = cell(column);
    if (value === null || value.length <= MAX_COMPARED_LENGTH) original[column] = value;
  }
  return original;
}

/** Why a connection's table takes no staged edits, or null when it does. */
export type RowEditRefusal = 'no-key' | 'key-type' | 'no-transactions';

interface RowEditColumnInfo {
  name: string;
  primaryKey?: boolean;
  type?: string;
}

const typesOf = (columns: ReadonlyArray<RowEditColumnInfo>) => Object.fromEntries(columns.flatMap((column) => (column.type ? [[column.name, column.type]] : [])));

export function rowEditRefusal(engine: SqlEngineKind, columns: ReadonlyArray<RowEditColumnInfo>, transactional = true): RowEditRefusal | null {
  const primaryKey = columns.filter((column) => column.primaryKey);
  if (primaryKey.length === 0) return 'no-key';
  if (!transactional) return 'no-transactions';
  const types = typesOf(columns);
  return primaryKey.every((column) => cellTextIsExact({ engine, types }, column.name)) ? null : 'key-type';
}

/** The table staged edits apply to, from the columns and primary key the engine reported; null when `rowEditRefusal` says no. */
export function rowEditTableFrom(engine: SqlEngineKind, schema: string, name: string, columns: ReadonlyArray<RowEditColumnInfo>, transactional = true): RowEditTable | null {
  if (rowEditRefusal(engine, columns, transactional)) return null;
  const primaryKey = columns.filter((column) => column.primaryKey).map((column) => column.name);
  return { engine, schema, name, columns: columns.map((column) => column.name), types: typesOf(columns), key: { kind: 'pk', columns: primaryKey } };
}

export const keyColumns = (table: RowEditTable): string[] => (table.key.kind === 'pk' ? table.key.columns : [ROWID]);

const isValue = (value: unknown): value is RowEditValue => value === null || (typeof value === 'string' && value.length <= MAX_VALUE_LENGTH);

/** Why this change set cannot be applied to `table`, or null when it can. */
export function rowEditProblem(table: RowEditTable, changes: RowEditChanges): 'empty' | 'too-many' | 'unknown-column' | 'missing-key' | 'invalid-value' | null {
  const total = changes.updates.length + changes.deletes.length + changes.inserts.length;
  if (total === 0) return 'empty';
  if (total > MAX_ROW_EDITS) return 'too-many';
  const columns = new Set(table.columns);
  const keys = keyColumns(table);
  const keyOk = (key: Values) => keys.every((column) => typeof key[column] === 'string') && Object.keys(key).length === keys.length;
  const writable = (column: string, value: RowEditValue) =>
    value === null || (!isBinaryColumn(table, column) && (value !== '' || takesEmptyText(table, column)));
  const valuesOk = (values: Values, needsOne: boolean) =>
    (!needsOne || Object.keys(values).length > 0) && Object.entries(values).every(([column, value]) => columns.has(column) && isValue(value) && writable(column, value));
  const originalOk = (original: Values | undefined) => Object.entries(original ?? {}).every(([column, value]) => columns.has(column) && isValue(value));
  for (const { key, values, original } of changes.updates) {
    if (!keyOk(key)) return 'missing-key';
    if (!valuesOk(values, true)) return Object.keys(values).every((column) => columns.has(column)) ? 'invalid-value' : 'unknown-column';
    if (!originalOk(original)) return 'unknown-column';
  }
  for (const { key, original } of changes.deletes) {
    if (!keyOk(key)) return 'missing-key';
    if (!originalOk(original)) return 'unknown-column';
  }
  for (const { values } of changes.inserts) {
    if (!valuesOk(values, false)) return Object.keys(values).every((column) => columns.has(column)) ? 'invalid-value' : 'unknown-column';
  }
  return null;
}

/**
 * The statements in the order they run: updates, deletes, then inserts.
 * `inline` writes the values as literals (DuckDB, which takes no
 * parameters here, and the review the user reads); otherwise they are bound
 * as `$n` on Postgres and Neon, `@pn` on SQL Server and `?` on MySQL and the SQLite family.
 */
export function rowEditStatements(table: RowEditTable, changes: RowEditChanges, inline: boolean): RowEditStatement[] {
  const dialect = sqlDialect(table.engine);
  const target = table.schema ? `${dialect.quoteIdentifier(table.schema)}.${dialect.quoteIdentifier(table.name)}` : dialect.quoteIdentifier(table.name);
  const column = (name: string) => (table.key.kind === 'rowid' && name === ROWID ? ROWID : dialect.quoteIdentifier(name));
  const keys = keyColumns(table);

  return [
    ...changes.updates.map(({ key, values, original }) => statement((value) => `UPDATE ${target} SET ${Object.entries(values).map(([name, item]) => `${column(name)} = ${value(item)}`).join(', ')} WHERE ${where(key, original, value)}`)),
    ...changes.deletes.map(({ key, original }) => statement((value) => `DELETE FROM ${target} WHERE ${where(key, original, value)}`)),
    ...changes.inserts.map(({ values }) => {
      const names = Object.keys(values);
      return statement((value) =>
        names.length === 0
          ? table.engine === 'mysql'
            ? `INSERT INTO ${target} () VALUES ()`
            : `INSERT INTO ${target} DEFAULT VALUES`
          : `INSERT INTO ${target} (${names.map(column).join(', ')}) VALUES (${names.map((name) => value(values[name]!)).join(', ')})`
      );
    }),
  ];

  function where(key: Values, original: Values | undefined, value: (item: RowEditValue) => string): string {
    // `value` binds in the order it is called, and MySQL's ? go by position, so this reads left to right.
    const found = keys.map((name) => `${column(name)} = ${value(key[name]!)}`);
    const unchanged = Object.entries(original ?? {})
      .filter(([name]) => !keys.includes(name) && comparesExactly(table, name))
      .map(([name, item]) => (item === null ? `${column(name)} IS NULL` : `${column(name)} = ${value(item)}`));
    return [...found, ...unchanged].join(' AND ');
  }

  function statement(build: (value: (item: RowEditValue) => string) => string): RowEditStatement {
    const params: RowEditValue[] = [];
    const sql = build((item) => {
      if (inline) return item === null ? 'NULL' : dialect.stringLiteral(item);
      params.push(item);
      return table.engine === 'postgres' || table.engine === 'neon' ? `$${params.length}` : table.engine === 'sqlserver' ? `@p${params.length}` : '?';
    });
    return { sql, params };
  }
}

/** The transaction as the user reviews it, values written in. */
export function rowEditReview(table: RowEditTable, changes: RowEditChanges): string {
  return ['BEGIN;', ...rowEditStatements(table, changes, true).map(({ sql }) => `${sql};`), 'COMMIT;'].join('\n');
}

const MAX_NAME = 256;

function parseValues(value: unknown, budget: { left: number }): Values | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 512) return null;
  const out: Values = {};
  for (const [name, item] of entries) {
    if (name.length === 0 || name.length > MAX_NAME || name === '__proto__' || !isValue(item)) return null;
    budget.left -= name.length + (item?.length ?? 0);
    if (budget.left < 0) return null;
    out[name] = item;
  }
  return out;
}

/** The change set as main accepts it over IPC: plain records of names and text, within the caps; null otherwise. */
export function parseRowEditChanges(value: unknown): RowEditChanges | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const list = (field: unknown) => (Array.isArray(field) && field.length <= MAX_ROW_EDITS ? field : null);
  const updates = list(record.updates);
  const deletes = list(record.deletes);
  const inserts = list(record.inserts);
  if (!updates || !deletes || !inserts || updates.length + deletes.length + inserts.length > MAX_ROW_EDITS) return null;
  const budget = { left: MAX_CHANGE_SET_LENGTH };
  const out: RowEditChanges = { updates: [], deletes: [], inserts: [] };
  for (const item of updates) {
    const key = parseValues((item as { key?: unknown })?.key, budget);
    const values = parseValues((item as { values?: unknown })?.values, budget);
    const original = parseValues((item as { original?: unknown })?.original ?? {}, budget);
    if (!key || !values || !original) return null;
    out.updates.push({ key, values, ...(Object.keys(original).length > 0 ? { original } : {}) });
  }
  for (const item of deletes) {
    const key = parseValues((item as { key?: unknown })?.key, budget);
    const original = parseValues((item as { original?: unknown })?.original ?? {}, budget);
    if (!key || !original) return null;
    out.deletes.push({ key, ...(Object.keys(original).length > 0 ? { original } : {}) });
  }
  for (const item of inserts) {
    const values = parseValues((item as { values?: unknown })?.values, budget);
    if (!values) return null;
    out.inserts.push({ values });
  }
  return out;
}
