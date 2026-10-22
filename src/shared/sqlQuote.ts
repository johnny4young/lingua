import type { SqlEngineKind } from './sqlConnections';
import { sqlDialect } from './sqlDialect';

/**
 * Quote an identifier (table / column name) for safe inlining into
 * generated SQL, in the engine's style: ANSI double quotes for DuckDB (the
 * default), Postgres and SQLite, backticks for MySQL, the quote character
 * doubled inside. Without this a table
 * name with a space, a reserved word (e.g. `select`), mixed case (which
 * DuckDB folds to lowercase when unquoted), or an injected `";` would
 * produce broken — or statement-chaining — SQL when interpolated as a
 * bare identifier.
 */
export function quoteSqlIdentifier(name: string, engine?: SqlEngineKind): string {
  return sqlDialect(engine).quoteIdentifier(name);
}

/** Quote a table reference segment-by-segment. A dotted display label such
 * as `lingua_ledger.runs` is two identifiers, not one identifier containing
 * a literal dot. Keeping this separate from `quoteSqlIdentifier` prevents
 * Explorer table opens from producing invalid SQL for non-main tables.
 */
export function quoteSqlTableReference(tableName: string, schemaName?: string, engine?: SqlEngineKind): string {
  return schemaName === undefined
    ? quoteSqlIdentifier(tableName, engine)
    : `${quoteSqlIdentifier(schemaName, engine)}.${quoteSqlIdentifier(tableName, engine)}`;
}
