/**
 * internal — SQL Formatter helper.
 *
 * Pure, offline, renderer-side. Lazily imports `sql-formatter`
 * (MIT, ~30 KB gz) so the largest single-use Developer Utilities dep
 * ships in its own chunk and only downloads when a user opens the SQL
 * Formatter tool — not for every DevUtils open.
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
 * Cached dynamic `sql-formatter` loader. A prior lazy attempt timed out
 * (>5 s) on cold cache inside vitest's jsdom; `tests/utils/sqlFormatter.test.ts`
 * now mocks the module so this dynamic path stays fast and deterministic in CI
 * while production gets the per-tool chunk split.
 */
type SqlFormatFn = typeof import('sql-formatter').format;
let sqlFormatPromise: Promise<SqlFormatFn> | null = null;
function loadSqlFormat(): Promise<SqlFormatFn> {
  sqlFormatPromise ??= import('sql-formatter')
    .then((module) => module.format)
    .catch((error) => {
      // Drop the cached rejection so a later format can retry instead of
      // permanently failing the session; `formatSql`'s try/catch still surfaces
      // this as the parseFailure error key.
      sqlFormatPromise = null;
      throw error;
    });
  return sqlFormatPromise;
}

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
    const sqlFormat = await loadSqlFormat();
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
