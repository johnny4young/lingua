/**
 * RL-068 — SQL Formatter helper.
 *
 * Pure, offline, renderer-side. Statically imports `sql-formatter`
 * (MIT, ~30 KB gz). The lib lives inside the lazy DevUtils chunk
 * regardless of where the import statement lives — the chunk only
 * hydrates when a user opens the Developer Utilities modal.
 *
 * Why static instead of `await import()`? A lazy variant timed out
 * past 5 s on cold cache inside vitest's jsdom environment. Static
 * import is deterministic across the Vite browser build and the
 * vitest SSR transform with no runtime difference for end users.
 *
 * Supported dialects line up with the AC: ANSI standard, PostgreSQL,
 * MySQL — the three the audience runs into most often. Other dialects
 * (`bigquery`, `sqlite`, `tsql`, etc.) are deliberately not exposed
 * yet to keep the panel surface small; the lib supports them and
 * adding rows is a one-line catalog change.
 */

export type SqlDialect = 'sql' | 'postgresql' | 'mysql';

export const SQL_DIALECTS: readonly SqlDialect[] = ['sql', 'postgresql', 'mysql'];

export interface SqlFormatOptions {
  readonly dialect: SqlDialect;
  /** Indent width in spaces (2 or 4). */
  readonly tabWidth: 2 | 4;
  /** Keyword case: keep, upper, or lower. */
  readonly keywordCase: 'preserve' | 'upper' | 'lower';
}

export type FormatSqlResult =
  | { ok: true; output: string }
  | { ok: false; errorKey: string; message?: string };

export const SQL_FORMATTER_MAX_BYTES = 200 * 1024; // 200 KB
export const SQL_FORMATTER_MAX_KB = Math.round(SQL_FORMATTER_MAX_BYTES / 1024);

/**
 * Static `sql-formatter` import. The lib is small (~30 KB gz) and
 * pure-JS — no DOM/Node-only APIs — so it tree-shakes cleanly into
 * the lazy DevUtils chunk. Static import also sidesteps a flaky
 * `await import('sql-formatter')` resolution inside vitest's jsdom
 * environment that timed out at >5 s on cold cache.
 */
import { format as sqlFormat } from 'sql-formatter';

export async function formatSql(
  source: string,
  options: SqlFormatOptions
): Promise<FormatSqlResult> {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return { ok: false, errorKey: 'utilities.tool.sqlFormatter.error.empty' };
  }

  if (new TextEncoder().encode(trimmed).byteLength > SQL_FORMATTER_MAX_BYTES) {
    return { ok: false, errorKey: 'utilities.tool.sqlFormatter.error.tooLarge' };
  }

  try {
    const output = sqlFormat(source, {
      language: options.dialect,
      tabWidth: options.tabWidth,
      keywordCase: options.keywordCase,
    });
    return { ok: true, output };
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.sqlFormatter.error.parseFailure',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
