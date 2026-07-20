import {
  DEVELOPER_UTILITIES,
  type DeveloperUtilityDefinition,
  type DeveloperUtilityId,
} from './developerUtilities';

/**
 * implementation detail — utility categorisation for the launcher sidebar.
 *
 * The 31 developer utilities render as one flat list, which reads as a
 * wall of options for someone opening the launcher for the first time.
 * Grouping the browse view (i.e. when the search box is empty) by a
 * small set of categories lets the eye scan by intent — "I want a text
 * tool" — instead of parsing every row. Search stays flat and ranked;
 * categories only shape the no-query browse order.
 *
 * The category map is exhaustive over `DeveloperUtilityId`: a new
 * utility fails to type-check here until it declares a home, so the
 * grouped view can never silently drop a tool.
 */
export type UtilityCategory =
  | 'data'
  | 'web'
  | 'crypto'
  | 'text'
  | 'visual'
  | 'time';

/** Display order of the category sections in the browse view. */
export const UTILITY_CATEGORY_ORDER: readonly UtilityCategory[] = [
  'data',
  'web',
  'crypto',
  'text',
  'visual',
  'time',
];

/** i18n key for each category's section header. */
export const UTILITY_CATEGORY_LABEL_KEY: Record<UtilityCategory, string> = {
  data: 'utilities.category.data',
  web: 'utilities.category.web',
  crypto: 'utilities.category.crypto',
  text: 'utilities.category.text',
  visual: 'utilities.category.visual',
  time: 'utilities.category.time',
};

export const UTILITY_CATEGORY: Record<DeveloperUtilityId, UtilityCategory> = {
  json: 'data',
  'number-base': 'data',
  'yaml-json': 'data',
  'json-csv': 'data',
  'sql-formatter': 'data',
  'mock-data': 'data',
  'utility-pipelines': 'data',
  url: 'web',
  'url-parser': 'web',
  'html-entity': 'web',
  'curl-to-code': 'web',
  'html-to-jsx': 'web',
  'backslash-escape': 'web',
  base64: 'crypto',
  'base64-image': 'crypto',
  jwt: 'crypto',
  hash: 'crypto',
  uuid: 'crypto',
  regex: 'text',
  diff: 'text',
  'beautify-minify': 'text',
  'string-case': 'text',
  'string-inspector': 'text',
  'markdown-preview': 'text',
  'lorem-ipsum': 'text',
  'random-string': 'text',
  color: 'visual',
  'svg-to-css': 'visual',
  'qr-code': 'visual',
  'cron-parser': 'time',
  timestamp: 'time',
};

/**
 * The utilities catalog reordered so items of the same category are
 * contiguous and the categories follow `UTILITY_CATEGORY_ORDER`. Stable
 * (module-level) so the browse list and its keyboard-nav array share one
 * identity. Within a category the original catalog order is preserved.
 */
export const CATEGORY_SORTED_UTILITIES: readonly DeveloperUtilityDefinition[] =
  UTILITY_CATEGORY_ORDER.flatMap((category) =>
    DEVELOPER_UTILITIES.filter((utility) => UTILITY_CATEGORY[utility.id] === category)
  );
