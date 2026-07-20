/**
 * internal — Cron Parser helper.
 *
 * Renderer-side, offline. Wraps two npm deps (lazy-imported) behind a
 * single `parseCronExpression` call that returns a tagged-union result:
 *
 * - `cron-parser` drives validation + next-run computation. We ask for
 *   `nextCount` upcoming runs from the current time; the iterator is
 *   forward-only, so we materialize the dates eagerly.
 * - `cronstrue` (i18n bundle) produces a human-readable explanation.
 *   The i18n variant pulls every locale the library ships with — not
 *   free, but isolated to the lazy Developer Utilities chunk; the main
 *   editor bundle is unaffected. We pass the renderer's active locale
 *   so EN / ES both translate.
 *
 * Both libraries throw on invalid input; we catch and surface translated
 * error keys instead of leaking library messages into the UI. The raw
 * message is still returned under `message` for panel interpolation so
 * the user can see *why* their expression was rejected ("Cannot parse
 * the minute field", etc.).
 *
 * The deps are MIT-licensed:
 * - cron-parser (https://github.com/harrisiirak/cron-parser)
 * - cronstrue (https://github.com/bradymholt/cRonstrue)
 */

export type CronParserLocale = 'en' | 'es';

export interface ParseCronOptions {
  /** Active renderer locale. Used for the cronstrue description only. */
  readonly locale: CronParserLocale;
  /** How many upcoming runs to materialize from the iterator. */
  readonly nextCount: number;
  /**
   * Reference date for "next runs" calculations. Defaults to `new Date()`
   * when omitted; tests pass a fixed clock so assertions are deterministic.
   */
  readonly now?: Date;
  /**
   * Timezone string (IANA format, e.g. `"UTC"` or `"America/New_York"`).
   * When omitted, the iterator runs against the machine's local timezone —
   * the right default for end users. Tests pass `"UTC"` so assertions
   * don't depend on the runner's TZ.
   */
  readonly tz?: string;
}

export type ParseCronResult =
  | {
      ok: true;
      /** Human-readable explanation in the requested locale. */
      description: string;
      /**
       * Upcoming runs starting strictly after `options.now`. Up to
       * `options.nextCount` entries; empty when the expression parses
       * successfully but produces no runs in the scheduling window
       * (e.g. `0 0 31 2 *` — Feb 31 never fires).
       */
      nextRuns: Date[];
    }
  | {
      ok: false;
      errorKey: string;
      /**
       * Raw library message for the panel to render beneath the translated
       * error prefix. Stays in English (cronstrue/cron-parser don't
       * localize their exception strings); omitted when the error is from
       * an empty input.
       */
      message?: string;
    };

/** Hard cap on `nextCount`. 100 covers any realistic "next N" pane without letting a panic input lock the UI. */
export const CRON_PARSER_MAX_NEXT = 100;

export async function parseCronExpression(
  expression: string,
  options: ParseCronOptions
): Promise<ParseCronResult> {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    return { ok: false, errorKey: 'utilities.tool.cron.error.empty' };
  }

  const rawCount = Number.isFinite(options.nextCount)
    ? Math.floor(options.nextCount)
    : 1;
  const nextCount = Math.min(Math.max(1, rawCount), CRON_PARSER_MAX_NEXT);

  let cronParserModule: typeof import('cron-parser');
  try {
    cronParserModule = await import('cron-parser');
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.cron.error.loadFailure',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  let iterator;
  try {
    iterator = cronParserModule.CronExpressionParser.parse(trimmed, {
      currentDate: options.now ?? new Date(),
      ...(options.tz ? { tz: options.tz } : {}),
    });
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.cron.error.invalid',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const nextRuns: Date[] = [];
  try {
    for (let index = 0; index < nextCount; index += 1) {
      nextRuns.push(iterator.next().toDate());
    }
  } catch (error) {
    // cron-parser throws when the iterator runs out of matches — most
    // commonly an expression like `0 0 31 2 *` that can never fire.
    // Treat that as a structurally-valid-but-empty schedule instead of
    // a hard error; the panel surfaces the friendlier `nextRuns.empty`
    // hint beneath the description. We only drop the partial-list
    // warning (if the iterator produced some runs first and then threw)
    // because cron-parser's error object does not distinguish the two
    // cases reliably across the 5.x series.
    void error;
  }

  // cronstrue's root-level i18n.js re-exports the all-locales bundle.
  // Import the explicit file because native Node ESM does not resolve
  // extensionless package subpaths without an exports map.
  type CronstrueI18n = {
    toString: (expression: string, options?: { locale?: string }) => string;
    default?: { toString: (expression: string, options?: { locale?: string }) => string };
    'module.exports'?: {
      toString: (expression: string, options?: { locale?: string }) => string;
    };
  };
  let cronstrueModule: CronstrueI18n;
  try {
    cronstrueModule = (await import('cronstrue/i18n.js')) as unknown as CronstrueI18n;
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.cron.error.loadFailure',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const cronstrueToString =
    cronstrueModule.toString ??
    cronstrueModule.default?.toString ??
    cronstrueModule['module.exports']?.toString;
  if (typeof cronstrueToString !== 'function') {
    return {
      ok: false,
      errorKey: 'utilities.tool.cron.error.loadFailure',
      message: 'cronstrue module did not expose a toString entry point',
    };
  }

  let description: string;
  try {
    description = cronstrueToString(trimmed, { locale: options.locale });
  } catch (error) {
    // cronstrue accepts expressions cron-parser does not (and vice versa
    // in rare edge cases). If the description pass fails *after* parsing
    // succeeded, surface an empty description rather than a hard error —
    // the user still gets the useful "next runs" output.
    description = '';
    void error;
  }

  return { ok: true, description, nextRuns };
}
