/**
 * What changes with the engine a query runs on: identifier quoting, string
 * literals, the case-insensitive "contains" predicate, the formatter language,
 * extra completion keywords and the engine's name in AI prompts. Local
 * DuckDB is the default, so callers without an engine keep today's SQL.
 */

import type { SqlEngineKind } from './sqlConnections';

type SqlFormatterLanguage = 'duckdb' | 'postgresql' | 'mysql' | 'sqlite' | 'transactsql' | 'clickhouse';

export interface SqlDialect {
  readonly engine: SqlEngineKind;
  /** The engine as an AI prompt names it. */
  readonly label: string;
  readonly formatter: SqlFormatterLanguage;
  quoteIdentifier(name: string): string;
  stringLiteral(value: string): string;
  /** SQL that holds when `column` contains `value` anywhere, ignoring case. */
  contains(column: string, value: string): string;
  /** Keywords this engine adds to the shared completion list. */
  readonly keywords: readonly string[];
  /** `SELECT *` of the first `limit` rows of `from`, as one statement. */
  firstRows(from: string, limit: number): string;
}

const limitRows = (from: string, limit: number) => `SELECT * FROM ${from} LIMIT ${limit};`;

const doubleQuoted = (name: string) => `"${name.replace(/"/g, '""')}"`;
const singleQuoted = (value: string) => `'${value.replaceAll("'", "''")}'`;
const likePattern = (value: string, escape: '\\' | '!') =>
  `%${value.replace(escape === '!' ? /[%_!]/g : /[%_\\]/g, `${escape}$&`)}%`;
/** ClickHouse reads backslash escapes inside quoted strings and names. */
const backslashed = (value: string, quote: string) => `${quote}${value.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`)}${quote}`;

const DIALECTS: Readonly<Record<Exclude<SqlEngineKind, 'libsql' | 'neon' | 'd1'>, SqlDialect>> = {
  duckdb: {
    engine: 'duckdb',
    label: 'DuckDB',
    formatter: 'duckdb',
    quoteIdentifier: doubleQuoted,
    stringLiteral: singleQuoted,
    contains: (column, value) => `CAST(${column} AS VARCHAR) ILIKE ${singleQuoted(likePattern(value, '\\'))} ESCAPE '\\'`,
    keywords: ['SUMMARIZE', 'PIVOT', 'UNPIVOT', 'QUALIFY', 'DESCRIBE', 'COPY', 'EXCLUDE', 'REPLACE'],
    firstRows: limitRows,
  },
  postgres: {
    engine: 'postgres',
    label: 'PostgreSQL',
    formatter: 'postgresql',
    quoteIdentifier: doubleQuoted,
    stringLiteral: singleQuoted,
    contains: (column, value) => `CAST(${column} AS TEXT) ILIKE ${singleQuoted(likePattern(value, '\\'))} ESCAPE '\\'`,
    keywords: ['ILIKE', 'RETURNING', 'LATERAL', 'DISTINCT ON', 'ON CONFLICT', 'SIMILAR TO', 'ARRAY', 'INTERVAL', 'EXPLAIN'],
    firstRows: limitRows,
  },
  mysql: {
    engine: 'mysql',
    label: 'MySQL',
    formatter: 'mysql',
    quoteIdentifier: (name) => `\`${name.replace(/`/g, '``')}\``,
    // Backslash escapes are on by default in MySQL strings.
    stringLiteral: (value) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`,
    // A backslash ESCAPE would itself need escaping in a MySQL string, so `!` marks the wildcards.
    contains: (column, value) => `CAST(${column} AS CHAR) LIKE ${DIALECTS.mysql.stringLiteral(likePattern(value, '!'))} ESCAPE '!'`,
    keywords: ['ON DUPLICATE KEY UPDATE', 'REPLACE INTO', 'AUTO_INCREMENT', 'SHOW TABLES', 'DESCRIBE', 'STRAIGHT_JOIN', 'INTERVAL', 'EXPLAIN'],
    firstRows: limitRows,
  },
  sqlite: {
    engine: 'sqlite',
    label: 'SQLite',
    formatter: 'sqlite',
    quoteIdentifier: doubleQuoted,
    stringLiteral: singleQuoted,
    // SQLite's LIKE ignores ASCII case already.
    contains: (column, value) => `CAST(${column} AS TEXT) LIKE ${singleQuoted(likePattern(value, '\\'))} ESCAPE '\\'`,
    keywords: ['PRAGMA', 'GLOB', 'AUTOINCREMENT', 'WITHOUT ROWID', 'RETURNING', 'EXPLAIN QUERY PLAN'],
    firstRows: limitRows,
  },
  sqlserver: {
    engine: 'sqlserver',
    label: 'SQL Server',
    formatter: 'transactsql',
    quoteIdentifier: (name) => `[${name.replaceAll(']', ']]')}]`,
    stringLiteral: (value) => `N${singleQuoted(value)}`,
    // `[` opens a character class in a T-SQL LIKE, so it is escaped along with the wildcards; LOWER ignores the collation.
    contains: (column, value) =>
      `LOWER(CAST(${column} AS NVARCHAR(MAX))) LIKE LOWER(N${singleQuoted(`%${value.replace(/[%_[\\]/g, '\\$&')}%`)}) ESCAPE '\\'`,
    keywords: ['TOP', 'OUTPUT', 'MERGE', 'CROSS APPLY', 'OUTER APPLY', 'OFFSET', 'FETCH NEXT', 'IDENTITY', 'NVARCHAR', 'WITH (NOLOCK)'],
    firstRows: (from, limit) => `SELECT TOP (${limit}) * FROM ${from};`,
  },
  clickhouse: {
    engine: 'clickhouse',
    label: 'ClickHouse',
    formatter: 'clickhouse',
    quoteIdentifier: (name) => backslashed(name, '`'),
    stringLiteral: (value) => backslashed(value, "'"),
    contains: (column, value) => `positionCaseInsensitiveUTF8(toString(${column}), ${backslashed(value, "'")}) > 0`,
    keywords: ['FINAL', 'PREWHERE', 'SAMPLE', 'ARRAY JOIN', 'LIMIT BY', 'WITH TOTALS', 'SETTINGS', 'FORMAT', 'EXPLAIN'],
    firstRows: limitRows,
  },
};

// The HTTP engines speak their family's SQL.
const HTTP_DIALECTS: Readonly<Record<'libsql' | 'neon' | 'd1', SqlDialect>> = {
  libsql: { ...DIALECTS.sqlite, engine: 'libsql', label: 'libSQL (Turso, SQLite-compatible)' },
  neon: { ...DIALECTS.postgres, engine: 'neon', label: 'PostgreSQL (Neon)' },
  d1: { ...DIALECTS.sqlite, engine: 'd1', label: 'Cloudflare D1 (SQLite)' },
};

export function sqlDialect(engine: SqlEngineKind | undefined): SqlDialect {
  const kind = engine ?? 'duckdb';
  return kind === 'libsql' || kind === 'neon' || kind === 'd1' ? HTTP_DIALECTS[kind] : DIALECTS[kind];
}
