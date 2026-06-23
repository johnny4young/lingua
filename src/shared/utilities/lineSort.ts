/**
 * RL-099 Slice 6 — `line-sort` adapter.
 *
 * Sort the input's lines. Pure shared implementation. CRLF and legacy
 * CR line endings are normalized to LF; a single trailing newline is
 * preserved so a sorted file keeps its shape. Options: `direction`
 * (asc / desc), `caseInsensitive` (fold the comparison key to lower
 * case), `unique` (drop later duplicates by the comparison key), and
 * `numeric` (fold D — natural order so `item2` precedes `item10`).
 *
 * Always settles `ok` — sorting text cannot fail. Plain comparison is
 * codepoint order (deterministic across environments); `numeric` mode
 * delegates to `localeCompare(..., { numeric: true })` pinned to `en`.
 */

import type { UtilityAdapter, UtilityOptionField } from './types';

/** Sort direction surfaced as the `direction` option. */
export const LINE_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type LineSortDirection = (typeof LINE_SORT_DIRECTIONS)[number];

/** Structured options for the `line-sort` adapter. */
export interface LineSortOptions {
  readonly direction: LineSortDirection;
  /** Compare with a lower-cased key so `B` and `b` sort together. */
  readonly caseInsensitive: boolean;
  /** Drop duplicate lines (by the comparison key), keeping the first. */
  readonly unique: boolean;
  /** Fold D — natural/numeric ordering (`item2` before `item10`). */
  readonly numeric: boolean;
}

const DIRECTION_SET: ReadonlySet<string> = new Set(LINE_SORT_DIRECTIONS);

const DIRECTION_OPTION: UtilityOptionField = {
  key: 'direction',
  type: 'select',
  labelKey: 'utilityPipeline.adapter.lineSort.options.direction.label',
  defaultValue: 'asc',
  options: LINE_SORT_DIRECTIONS.map((value) => ({
    value,
    labelKey: `utilityPipeline.adapter.lineSort.options.direction.${value}`,
  })),
};

const CASE_OPTION: UtilityOptionField = {
  key: 'caseInsensitive',
  type: 'boolean',
  labelKey: 'utilityPipeline.adapter.lineSort.options.caseInsensitive.label',
  defaultValue: false,
};

const UNIQUE_OPTION: UtilityOptionField = {
  key: 'unique',
  type: 'boolean',
  labelKey: 'utilityPipeline.adapter.lineSort.options.unique.label',
  defaultValue: false,
};

const NUMERIC_OPTION: UtilityOptionField = {
  key: 'numeric',
  type: 'boolean',
  labelKey: 'utilityPipeline.adapter.lineSort.options.numeric.label',
  defaultValue: false,
};

function parseBoolean(value: unknown, fallback: boolean): boolean | null {
  if (value === undefined) return fallback;
  return typeof value === 'boolean' ? value : null;
}

export const lineSortAdapter: UtilityAdapter<LineSortOptions> = {
  id: 'line-sort',
  titleKey: 'utilityPipeline.adapter.lineSort.title',
  descriptionKey: 'utilityPipeline.adapter.lineSort.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [DIRECTION_OPTION, CASE_OPTION, UNIQUE_OPTION, NUMERIC_OPTION],
  defaultOptions: () => ({
    direction: 'asc',
    caseInsensitive: false,
    unique: false,
    numeric: false,
  }),
  parseOptions: (raw) => {
    if (raw === undefined || raw === null) {
      return {
        direction: 'asc',
        caseInsensitive: false,
        unique: false,
        numeric: false,
      };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    const candidate = raw as {
      direction?: unknown;
      caseInsensitive?: unknown;
      unique?: unknown;
      numeric?: unknown;
    };
    const direction =
      candidate.direction === undefined ? 'asc' : candidate.direction;
    if (typeof direction !== 'string' || !DIRECTION_SET.has(direction)) {
      return null;
    }
    const caseInsensitive = parseBoolean(candidate.caseInsensitive, false);
    const unique = parseBoolean(candidate.unique, false);
    const numeric = parseBoolean(candidate.numeric, false);
    if (caseInsensitive === null || unique === null || numeric === null) {
      return null;
    }
    return {
      direction: direction as LineSortDirection,
      caseInsensitive,
      unique,
      numeric,
    };
  },
  run: async (input, options) => {
    const normalized = input.replace(/\r\n?|\n/gu, '\n');
    const hadTrailingNewline = normalized.endsWith('\n');
    const lines = normalized.split('\n');
    if (hadTrailingNewline) lines.pop();

    const keyOf = (line: string): string =>
      options.caseInsensitive ? line.toLowerCase() : line;

    let working = lines;
    if (options.unique) {
      const seen = new Set<string>();
      working = lines.filter((line) => {
        const key = keyOf(line);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    const sorted = working.slice().sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      const cmp = options.numeric
        ? ka.localeCompare(kb, 'en', { numeric: true })
        : ka < kb
          ? -1
          : ka > kb
            ? 1
            : 0;
      return options.direction === 'desc' ? -cmp : cmp;
    });

    const joined = sorted.join('\n');
    return { ok: true, value: hadTrailingNewline ? `${joined}\n` : joined };
  },
};
