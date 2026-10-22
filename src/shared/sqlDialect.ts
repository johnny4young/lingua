/**
 * What changes with the engine a query runs on: identifier quoting, string
 * literals, the case-insensitive "contains" predicate, the formatter language,
 * extra completion keywords and the engine's name in AI prompts. Local
 * DuckDB is the default, so callers without an engine keep today's SQL.
 */

import type { SqlEngineKind } from './sqlConnections';

type SqlFormatterLanguage = 'duckdb' | 'postgresql' | 'mysql' | 'sqlite';

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
}

const doubleQuoted = (name: string) => `"${name.replace(/"/g, '""')}"`;
const singleQuoted = (value: string) => `'${value.replaceAll("'", "''")}'`;
const likePattern = (value: string, escape: '\\' | '!') =>
  `%${value.replace(escape === '!' ? /[%_!]/g : /[%_\\]/g, `${escape}$&`)}%`;

const DIALECTS: Readonly<Record<SqlEngineKind, SqlDialect>> = {
  duckdb: {
    engine: 'duckdb',
    label: 'DuckDB',
    formatter: 'duckdb',
    quoteIdentifier: doubleQuoted,
    stringLiteral: singleQuoted,
    contains: (column, value) => `CAST(${column} AS VARCHAR) ILIKE ${singleQuoted(likePattern(value, '\\'))} ESCAPE '\\'`,
    keywords: ['SUMMARIZE', 'PIVOT', 'UNPIVOT', 'QUALIFY', 'DESCRIBE', 'COPY', 'EXCLUDE', 'REPLACE'],
  },
  postgres: {
    engine: 'postgres',
    label: 'PostgreSQL',
    formatter: 'postgresql',
    quoteIdentifier: doubleQuoted,
    stringLiteral: singleQuoted,
    contains: (column, value) => `CAST(${column} AS TEXT) ILIKE ${singleQuoted(likePattern(value, '\\'))} ESCAPE '\\'`,
    keywords: ['ILIKE', 'RETURNING', 'LATERAL', 'DISTINCT ON', 'ON CONFLICT', 'SIMILAR TO', 'ARRAY', 'INTERVAL', 'EXPLAIN'],
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
  },
};

export function sqlDialect(engine: SqlEngineKind | undefined): SqlDialect {
  return DIALECTS[engine ?? 'duckdb'];
}
