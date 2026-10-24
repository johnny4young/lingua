/**
 * Copy to Local: a connection's result becomes a Local DuckDB table. Rows
 * arrive as the grid holds them (wide numbers, decimals and dates as text,
 * bytes as base64), travel to DuckDB as newline-delimited JSON of strings,
 * and are cast to each column's DuckDB type there, so no value is guessed.
 */

import type { SqlColumnMetadata } from './sqlWorkspace';
import { quoteSqlIdentifier } from './sqlQuote';

export interface LocalCopyColumn {
  /** The column name in the new table, unique ignoring case. */
  name: string;
  /** A DuckDB type from a fixed list; anything else is VARCHAR. */
  type: string;
}

const SAME: ReadonlySet<string> = new Set([
  'BOOLEAN',
  'BIGINT',
  'HUGEINT',
  'UTINYINT',
  'USMALLINT',
  'UINTEGER',
  'UBIGINT',
  'FLOAT',
  'DOUBLE',
  'DATE',
  'TIME',
  'TIMESTAMP',
  'UUID',
  'BLOB',
]);

const ALIASES: Readonly<Record<string, string>> = {
  // Narrow signed integers widen: SQLite's INTEGER is 64-bit, and MySQL's unsigned INT, SMALLINT and TINYINT pass their signed range.
  TINYINT: 'BIGINT',
  SMALLINT: 'BIGINT',
  INTEGER: 'BIGINT',
  INT: 'BIGINT',
  REAL: 'FLOAT',
  DATETIME: 'TIMESTAMP',
  DATETIME2: 'TIMESTAMP',
  'TIMESTAMP WITH TIME ZONE': 'TIMESTAMPTZ',
  TIMESTAMPTZ: 'TIMESTAMPTZ',
};

/**
 * The DuckDB type for a column the grid reports. Exact numeric types keep
 * their precision up to DuckDB's 38 digits; text, JSON, intervals, money
 * and anything unknown stay VARCHAR, so a value is never lost to a cast.
 */
export function localColumnType(type: string): string {
  const name = type.trim().toUpperCase();
  if (SAME.has(name)) return name;
  if (ALIASES[name]) return ALIASES[name];
  const decimal = /^DECIMAL\((\d{1,2}),\s*(\d{1,2})\)$/.exec(name);
  if (decimal && Number(decimal[1]) >= 1 && Number(decimal[1]) <= 38 && Number(decimal[2]) <= Number(decimal[1])) {
    return `DECIMAL(${Number(decimal[1])},${Number(decimal[2])})`;
  }
  return 'VARCHAR';
}

/** The new table's columns: each type mapped, repeated names suffixed _2, _3… (DuckDB names ignore case). */
export function localCopyColumns(columns: ReadonlyArray<SqlColumnMetadata>): LocalCopyColumn[] {
  const taken = new Set<string>();
  return columns.map((column, index) => {
    const base = column.name.trim() || `column${index + 1}`;
    let name = base;
    for (let suffix = 2; taken.has(name.toLowerCase()); suffix += 1) name = `${base}_${suffix}`;
    taken.add(name.toLowerCase());
    return { name, type: localColumnType(column.type) };
  });
}

/** A cell as text DuckDB casts: numbers and booleans as written, nested values as JSON. */
function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value);
}

/** A value that does not fit its column's type; the copy stops and creates nothing. */
export class LocalCopyValueError extends Error {
  constructor(
    readonly column: string,
    readonly type: string
  ) {
    super(`Column ${column} has a value that is not a valid ${type}, so nothing was copied.`);
  }
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Rows as newline-delimited JSON, read by position from `sourceNames` into keys c0, c1… */
export function localCopyLines(rows: ReadonlyArray<Record<string, unknown>>, sourceNames: ReadonlyArray<string>, columns: ReadonlyArray<LocalCopyColumn>): string {
  let out = '';
  for (const row of rows) {
    const record: Record<string, string | null> = {};
    sourceNames.forEach((name, index) => {
      const text = cellText(row[name]);
      // DuckDB-WASM cannot report a failed decode, so bytes are checked here.
      if (text !== null && columns[index]?.type === 'BLOB' && !BASE64.test(text)) throw new LocalCopyValueError(columns[index]!.name, 'BLOB');
      record[`c${index}`] = text;
    });
    out += `${JSON.stringify(record)}\n`;
  }
  return out;
}

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function localCopyCreate(table: string, columns: ReadonlyArray<LocalCopyColumn>): string {
  return `CREATE TABLE ${quoteSqlIdentifier(table)} (${columns.map((column) => `${quoteSqlIdentifier(column.name)} ${column.type}`).join(', ')})`;
}

const reader = (columns: ReadonlyArray<LocalCopyColumn>, file: string) =>
  `read_json(${literal(file)}, format = 'newline_delimited', columns = {${columns.map((_, index) => `c${index}: 'VARCHAR'`).join(', ')}})`;

const cast = (column: LocalCopyColumn) => column.type !== 'VARCHAR' && column.type !== 'BLOB';

/**
 * Counts, per typed column, the values its type cannot hold. DuckDB-WASM
 * cannot report a failed cast, so the copy checks with TRY_CAST first and
 * names the column itself. Null when every column is text or bytes.
 */
export function localCopyCheck(columns: ReadonlyArray<LocalCopyColumn>, file: string): string | null {
  const checks = columns.flatMap((column, index) => (cast(column) ? [`count(*) FILTER (WHERE c${index} IS NOT NULL AND TRY_CAST(c${index} AS ${column.type}) IS NULL) AS "${index}"`] : []));
  return checks.length === 0 ? null : `SELECT ${checks.join(', ')} FROM ${reader(columns, file)}`;
}

/** One checked batch from the registered JSON file into the table. */
export function localCopyInsert(table: string, columns: ReadonlyArray<LocalCopyColumn>, file: string): string {
  const values = columns.map((column, index) => (column.type === 'BLOB' ? `from_base64(c${index})` : cast(column) ? `TRY_CAST(c${index} AS ${column.type})` : `c${index}`));
  return `INSERT INTO ${quoteSqlIdentifier(table)} SELECT ${values.join(', ')} FROM ${reader(columns, file)}`;
}

/** The first column the check found a bad value in, from its one-row result. */
export function localCopyCheckFailure(columns: ReadonlyArray<LocalCopyColumn>, row: Record<string, unknown> | undefined): LocalCopyValueError | null {
  for (const [index, column] of columns.entries()) {
    if (Number(row?.[String(index)] ?? 0) > 0) return new LocalCopyValueError(column.name, column.type);
  }
  return null;
}

const ORIGIN_KIND = 'lingua.copy';

/** Where a copied table came from, stored as its COMMENT: the connection's name and when, never the SQL. */
export interface LocalCopyOrigin {
  connection: string;
  at: string;
}

export function localCopyComment(table: string, origin: LocalCopyOrigin): string {
  return `COMMENT ON TABLE ${quoteSqlIdentifier(table)} IS ${literal(JSON.stringify({ kind: ORIGIN_KIND, connection: origin.connection, at: origin.at }))}`;
}

/** The origin a table comment records, or null for any other comment. */
export function parseLocalCopyOrigin(comment: unknown): LocalCopyOrigin | null {
  if (typeof comment !== 'string' || !comment.startsWith('{')) return null;
  try {
    const value = JSON.parse(comment) as { kind?: unknown; connection?: unknown; at?: unknown };
    if (value.kind !== ORIGIN_KIND || typeof value.connection !== 'string' || typeof value.at !== 'string') return null;
    return { connection: value.connection.slice(0, 80), at: value.at };
  } catch {
    return null;
  }
}
