/**
 * implementation — `slugify` adapter.
 *
 * Turn arbitrary text into a URL-safe slug. Pure shared
 * implementation. NFKD-normalizes then strips combining diacritics
 * (`Crème` → `creme`), replaces every run of non-alphanumeric chars
 * with the chosen separator, and trims separators from both edges.
 * Options: `separator` (hyphen / underscore) and `lowercase`.
 *
 * Always settles `ok`; all-symbol input collapses to an empty slug
 * rather than failing (an empty string is a valid, if unhelpful,
 * pipeline value the next step can react to).
 */

import type { UtilityAdapter, UtilityOptionField } from './types';

/** Separator choices surfaced as the `separator` option. */
export const SLUGIFY_SEPARATORS = ['hyphen', 'underscore'] as const;
export type SlugifySeparator = (typeof SLUGIFY_SEPARATORS)[number];

/** Structured options for the `slugify` adapter. */
export interface SlugifyOptions {
  readonly separator: SlugifySeparator;
  readonly lowercase: boolean;
}

const SEPARATOR_SET: ReadonlySet<string> = new Set(SLUGIFY_SEPARATORS);
const SEPARATOR_CHAR: Readonly<Record<SlugifySeparator, string>> = {
  hyphen: '-',
  underscore: '_',
};

const SEPARATOR_OPTION: UtilityOptionField = {
  key: 'separator',
  type: 'select',
  labelKey: 'utilityPipeline.adapter.slugify.options.separator.label',
  defaultValue: 'hyphen',
  options: SLUGIFY_SEPARATORS.map((value) => ({
    value,
    labelKey: `utilityPipeline.adapter.slugify.options.separator.${value}`,
  })),
};

const LOWERCASE_OPTION: UtilityOptionField = {
  key: 'lowercase',
  type: 'boolean',
  labelKey: 'utilityPipeline.adapter.slugify.options.lowercase.label',
  defaultValue: true,
};

export const slugifyAdapter: UtilityAdapter<SlugifyOptions> = {
  id: 'slugify',
  titleKey: 'utilityPipeline.adapter.slugify.title',
  descriptionKey: 'utilityPipeline.adapter.slugify.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [SEPARATOR_OPTION, LOWERCASE_OPTION],
  defaultOptions: () => ({ separator: 'hyphen', lowercase: true }),
  parseOptions: (raw) => {
    if (raw === undefined || raw === null) {
      return { separator: 'hyphen', lowercase: true };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    const candidate = raw as { separator?: unknown; lowercase?: unknown };
    const separator =
      candidate.separator === undefined ? 'hyphen' : candidate.separator;
    const lowercase =
      candidate.lowercase === undefined ? true : candidate.lowercase;
    if (typeof separator !== 'string' || !SEPARATOR_SET.has(separator)) {
      return null;
    }
    if (typeof lowercase !== 'boolean') return null;
    return { separator: separator as SlugifySeparator, lowercase };
  },
  run: async (input, options) => {
    const sep = SEPARATOR_CHAR[options.separator];
    let slug = input
      .normalize('NFKD')
      // Strip combining diacritical marks (U+0300..U+036F) left behind
      // by NFKD so accented letters implementation note their ASCII base.
      .replace(/[̀-ͯ]/gu, '')
      .replace(/[^a-zA-Z0-9]+/gu, sep)
      .replace(/^[-_]+|[-_]+$/gu, '');
    if (options.lowercase) slug = slug.toLowerCase();
    return { ok: true, value: slug };
  },
};
