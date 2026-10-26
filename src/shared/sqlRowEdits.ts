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
  key: RowEditKey;
}

/** A cell as typed: text the engine converts to the column's type, or null for SQL NULL. */
export type RowEditValue = string | null;

type Values = Record<string, RowEditValue>;

export interface RowEditChanges {
  /** The key values that find each row, and its new values by column. */
  updates: Array<{ key: Values; values: Values }>;
  deletes: Array<{ key: Values }>;
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

/** The table staged edits apply to, from the columns and primary key the engine reported; null without a whole key. */
export function rowEditTableFrom(engine: SqlEngineKind, schema: string, name: string, columns: ReadonlyArray<{ name: string; primaryKey?: boolean }>): RowEditTable | null {
  const primaryKey = columns.filter((column) => column.primaryKey).map((column) => column.name);
  if (primaryKey.length === 0) return null;
  return { engine, schema, name, columns: columns.map((column) => column.name), key: { kind: 'pk', columns: primaryKey } };
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
  const valuesOk = (values: Values, needsOne: boolean) =>
    (!needsOne || Object.keys(values).length > 0) && Object.entries(values).every(([column, value]) => columns.has(column) && isValue(value));
  for (const { key, values } of changes.updates) {
    if (!keyOk(key)) return 'missing-key';
    if (!valuesOk(values, true)) return Object.keys(values).every((column) => columns.has(column)) ? 'invalid-value' : 'unknown-column';
  }
  for (const { key } of changes.deletes) if (!keyOk(key)) return 'missing-key';
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
    ...changes.updates.map(({ key, values }) => statement((value) => `UPDATE ${target} SET ${Object.entries(values).map(([name, item]) => `${column(name)} = ${value(item)}`).join(', ')} WHERE ${where(key, value)}`)),
    ...changes.deletes.map(({ key }) => statement((value) => `DELETE FROM ${target} WHERE ${where(key, value)}`)),
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

  function where(key: Values, value: (item: RowEditValue) => string): string {
    return keys.map((name) => `${column(name)} = ${value(key[name]!)}`).join(' AND ');
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
    if (!key || !values) return null;
    out.updates.push({ key, values });
  }
  for (const item of deletes) {
    const key = parseValues((item as { key?: unknown })?.key, budget);
    if (!key) return null;
    out.deletes.push({ key });
  }
  for (const item of inserts) {
    const values = parseValues((item as { values?: unknown })?.values, budget);
    if (!values) return null;
    out.inserts.push({ values });
  }
  return out;
}
