import type { SqlEngineKind } from '../../../shared/sqlConnections';
import { quoteSqlTableReference } from '../../../shared/sqlQuote';

export { quoteSqlIdentifier, quoteSqlTableReference } from '../../../shared/sqlQuote';

/**
 * Build the `SELECT * FROM <table> LIMIT 100;` that opening a table from
 * the Explorer runs, and that Edit in editor takes into the query. The table name is quoted so
 * any identifier the engine reports (spaces, reserved words, mixed
 * case, special characters) round-trips into a valid, single statement.
 */
export function buildSelectStarter(tableName: string, schemaName?: string, engine?: SqlEngineKind): string {
  return `SELECT * FROM ${quoteSqlTableReference(tableName, schemaName, engine)} LIMIT 100;`;
}

/** `HH:MM:SS` in the user's locale; the raw string when it is not a date. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** A cell as the grid shows it: null as `null`, objects as JSON. */
export function renderCell(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
