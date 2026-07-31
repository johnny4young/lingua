import type { Entitlement } from '../../shared/entitlements';

/**
 * Startup-safe identity and authorization data for developer utilities.
 *
 * Keep search descriptions, aliases, keywords, and action labels out of this
 * module. Those belong to the reference catalog that loads with the Command
 * Palette or Utilities workspace.
 */
export type DeveloperUtilityId =
  | 'json'
  | 'base64'
  | 'url'
  | 'url-parser'
  | 'uuid'
  | 'hash'
  | 'timestamp'
  | 'jwt'
  | 'regex'
  | 'color'
  | 'diff'
  | 'number-base'
  | 'beautify-minify'
  | 'string-case'
  | 'html-entity'
  | 'string-inspector'
  | 'qr-code'
  | 'backslash-escape'
  | 'random-string'
  | 'mock-data'
  | 'base64-image'
  | 'lorem-ipsum'
  | 'svg-to-css'
  | 'cron-parser'
  | 'html-to-jsx'
  | 'curl-to-code'
  | 'yaml-json'
  | 'json-csv'
  | 'markdown-preview'
  | 'sql-formatter'
  | 'utility-pipelines';

export interface DeveloperUtilityCatalogEntry {
  readonly id: DeveloperUtilityId;
  readonly titleKey: string;
  readonly requiresEntitlement?: Entitlement;
}

export const DEFAULT_DEVELOPER_UTILITY_ID: DeveloperUtilityId = 'json';

export const DEVELOPER_UTILITY_CATALOG = [
  {
    id: 'json',
    titleKey: 'utilities.tool.json.titleLabel',
  },
  {
    id: 'base64',
    titleKey: 'utilities.tool.base64.titleLabel',
  },
  {
    id: 'url',
    titleKey: 'utilities.tool.url.titleLabel',
  },
  {
    id: 'url-parser',
    titleKey: 'utilities.tool.urlParser.titleLabel',
  },
  {
    id: 'uuid',
    titleKey: 'utilities.tool.uuid.titleLabel',
  },
  {
    id: 'hash',
    titleKey: 'utilities.tool.hash.titleLabel',
  },
  {
    id: 'timestamp',
    titleKey: 'utilities.tool.timestamp.titleLabel',
  },
  {
    id: 'jwt',
    titleKey: 'utilities.tool.jwt.titleLabel',
  },
  {
    id: 'regex',
    titleKey: 'utilities.tool.regex.titleLabel',
  },
  {
    id: 'color',
    titleKey: 'utilities.tool.color.titleLabel',
  },
  {
    id: 'diff',
    titleKey: 'utilities.tool.diff.titleLabel',
  },
  {
    id: 'number-base',
    titleKey: 'utilities.tool.numberBase.titleLabel',
  },
  {
    id: 'beautify-minify',
    titleKey: 'utilities.tool.beautifyMinify.titleLabel',
  },
  {
    id: 'string-case',
    titleKey: 'utilities.tool.stringCase.titleLabel',
  },
  {
    id: 'html-entity',
    titleKey: 'utilities.tool.htmlEntity.titleLabel',
  },
  {
    id: 'string-inspector',
    titleKey: 'utilities.tool.stringInspector.titleLabel',
  },
  {
    id: 'qr-code',
    titleKey: 'utilities.tool.qrCode.titleLabel',
  },
  {
    id: 'backslash-escape',
    titleKey: 'utilities.tool.backslashEscape.titleLabel',
  },
  {
    id: 'random-string',
    titleKey: 'utilities.tool.randomString.titleLabel',
  },
  {
    id: 'mock-data',
    titleKey: 'utilities.tool.mockData.titleLabel',
  },
  {
    id: 'base64-image',
    titleKey: 'utilities.tool.base64Image.titleLabel',
  },
  {
    id: 'lorem-ipsum',
    titleKey: 'utilities.tool.loremIpsum.titleLabel',
  },
  {
    id: 'svg-to-css',
    titleKey: 'utilities.tool.svgToCss.titleLabel',
  },
  {
    id: 'cron-parser',
    titleKey: 'utilities.tool.cron.titleLabel',
  },
  {
    id: 'html-to-jsx',
    titleKey: 'utilities.tool.htmlToJsx.titleLabel',
  },
  {
    id: 'curl-to-code',
    titleKey: 'utilities.tool.curlToCode.titleLabel',
  },
  {
    id: 'yaml-json',
    titleKey: 'utilities.tool.yamlJson.titleLabel',
  },
  {
    id: 'json-csv',
    titleKey: 'utilities.tool.jsonCsv.titleLabel',
  },
  {
    id: 'markdown-preview',
    titleKey: 'utilities.tool.markdownPreview.titleLabel',
  },
  {
    id: 'sql-formatter',
    titleKey: 'utilities.tool.sqlFormatter.titleLabel',
  },
  {
    id: 'utility-pipelines',
    titleKey: 'utilities.tool.utilityPipelines.titleLabel',
    requiresEntitlement: 'DEV_UTILITIES',
  },
] as const satisfies readonly DeveloperUtilityCatalogEntry[];

export function findDeveloperUtilityCatalogEntry(
  id: DeveloperUtilityId
): DeveloperUtilityCatalogEntry {
  const fallbackUtility = DEVELOPER_UTILITY_CATALOG[0];
  if (!fallbackUtility) {
    throw new Error('Developer utilities catalog is empty.');
  }

  return DEVELOPER_UTILITY_CATALOG.find(utility => utility.id === id) ?? fallbackUtility;
}
