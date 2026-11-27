import type { SqlEngineKind } from '../../../shared/sqlConnections';
import { sqlDialect } from '../../../shared/sqlDialect';
import { quoteSqlTableReference } from '../../../shared/sqlQuote';
import { coerceSupportedLanguage } from '../../../shared/i18n/languages';
import { formatNumber } from '../../i18n/formatNumber';

export { quoteSqlIdentifier, quoteSqlTableReference } from '../../../shared/sqlQuote';

/**
 * Build the `SELECT * FROM <table> LIMIT 100;` (`SELECT TOP (100)` on SQL
 * Server) that opening a table from the Explorer runs, and that Edit in
 * editor takes into the query. The table name is quoted so
 * any identifier the engine reports (spaces, reserved words, mixed
 * case, special characters) round-trips into a valid, single statement.
 */
export function buildSelectStarter(tableName: string, schemaName?: string, engine?: SqlEngineKind): string {
  return sqlDialect(engine).firstRows(quoteSqlTableReference(tableName, schemaName, engine), 100);
}

/** `HH:MM:SS` in the app language; the raw string when it is not a date. */
export function formatClock(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(coerceSupportedLanguage(language), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const PLAIN_NUMBER = /^(-?)(\d+)(?:\.(\d+))?$/;
const decimalSeparators = new Map<string, string>();

/**
 * A number cell as the grid shows it: the integer part grouped in the app
 * locale, every fraction digit kept. Exponent forms and non-numbers return
 * `renderCell`'s text; copy and export keep reading the raw value.
 */
export function renderNumberCell(value: unknown, language: string): string {
  // Most cells are plain integers: one cached formatter call, no string parsing.
  if (Number.isSafeInteger(value)) return formatNumber(value as number, language);
  const raw = renderCell(value);
  const match = typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? PLAIN_NUMBER.exec(raw) : null;
  if (!match) return raw;
  const [, sign, whole, fraction] = match;
  const grouped = formatNumber(BigInt(whole!), language);
  if (fraction === undefined) return `${sign}${grouped}`;
  const locale = coerceSupportedLanguage(language);
  let separator = decimalSeparators.get(locale);
  if (separator === undefined) {
    separator = new Intl.NumberFormat(locale).formatToParts(0.5).find((part) => part.type === 'decimal')?.value ?? '.';
    decimalSeparators.set(locale, separator);
  }
  return `${sign}${grouped}${separator}${fraction}`;
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
