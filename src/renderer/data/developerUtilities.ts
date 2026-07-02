import {
  detectsAsAbsoluteUrl,
  detectsAsBackslashEscaped,
  detectsAsBase64,
  detectsAsBeautifiable,
  detectsAsCaseConvertible,
  detectsAsColor,
  detectsAsCron,
  detectsAsCsv,
  detectsAsCurl,
  detectsAsDataUri,
  detectsAsHashable,
  detectsAsHtml,
  detectsAsHtmlEntity,
  detectsAsInspectableText,
  detectsAsJson,
  detectsAsJwt,
  detectsAsMarkdown,
  detectsAsNumber,
  detectsAsRegex,
  detectsAsSql,
  detectsAsSvg,
  detectsAsTimestamp,
  detectsAsUrlEncoded,
  detectsAsUuid,
  detectsAsYaml,
} from '../utils/developerUtilities';
import type { Entitlement } from '../../shared/entitlements';

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

/**
 * RL-069 Slice 2 — input shape passed to a utility's `detect` predicate.
 *
 * Most panels only consume `primary` (the single textarea / input).
 * Diff and Regex consume both `primary` and `secondary` because they
 * compare two values; the predicate fires only when both are present.
 * Generators (random-string, lorem-ipsum) declare no `detect` at all
 * and the toolbar hides the Apply button accordingly.
 */
export interface UtilityDetectInputs {
  primary: string;
  secondary?: string;
}

export interface DeveloperUtilityDefinition {
  id: DeveloperUtilityId;
  titleKey: string;
  actionLabelKey: string;
  descriptionKey: string;
  keywords: string[];
  /**
   * RL-069 Slice 1 — short-form lookup tokens for the fuzzy search.
   *
   * Keywords stay focused on synonyms a user might type when describing
   * the tool ("validate", "encode"). Aliases are abbreviations and
   * acronyms ("b64", "ts", "md") that don't read as descriptive
   * keywords but make Cmd+K muscle memory faster. Optional — only
   * panels with an obvious shorthand carry them.
   */
  aliases?: readonly string[];
  /**
   * Optional paid feature gate for advanced workflow surfaces that live
   * inside the otherwise-free utilities catalog. The base single-shot
   * utilities are Free; entries that persist or automate multi-step
   * workflows declare their entitlement explicitly so launchers and the
   * workspace can enforce the same policy.
   */
  requiresEntitlement?: Entitlement;
  /**
   * RL-069 Slice 2 — input-shape predicate used by the ⚡ Apply
   * button and the Mod+Shift+A shortcut. When omitted, the panel
   * is treated as a pure generator (random-string, lorem-ipsum)
   * and the Apply button is hidden.
   *
   * Implementations stay synchronous and cheap — they fire on every
   * keystroke for the disabled state. Where a parse step is
   * unavoidable, the predicate reuses the existing analyzer (e.g.
   * `detectsAsJson` calls `analyzeJson`).
   */
  detect?: (inputs: UtilityDetectInputs) => boolean;
}

export const DEFAULT_DEVELOPER_UTILITY_ID: DeveloperUtilityId = 'json';

export const DEVELOPER_UTILITIES: readonly DeveloperUtilityDefinition[] = [
  {
    id: 'json',
    titleKey: 'utilities.tool.json.titleLabel',
    actionLabelKey: 'utilities.tool.json.label',
    descriptionKey: 'utilities.tool.json.description',
    keywords: ['json', 'format', 'validate', 'viewer', 'pretty'],
    detect: ({ primary }) => detectsAsJson(primary),
  },
  {
    id: 'base64',
    titleKey: 'utilities.tool.base64.titleLabel',
    actionLabelKey: 'utilities.tool.base64.label',
    descriptionKey: 'utilities.tool.base64.description',
    keywords: ['base64', 'encode', 'decode'],
    aliases: ['b64'],
    detect: ({ primary }) => detectsAsBase64(primary),
  },
  {
    id: 'url',
    titleKey: 'utilities.tool.url.titleLabel',
    actionLabelKey: 'utilities.tool.url.label',
    descriptionKey: 'utilities.tool.url.description',
    keywords: ['url', 'encode', 'decode', 'querystring'],
    detect: ({ primary }) => detectsAsUrlEncoded(primary),
  },
  {
    id: 'url-parser',
    titleKey: 'utilities.tool.urlParser.titleLabel',
    actionLabelKey: 'utilities.tool.urlParser.label',
    descriptionKey: 'utilities.tool.urlParser.description',
    keywords: ['url', 'parse', 'host', 'query', 'path', 'inspect'],
    detect: ({ primary }) => detectsAsAbsoluteUrl(primary),
  },
  {
    id: 'uuid',
    titleKey: 'utilities.tool.uuid.titleLabel',
    actionLabelKey: 'utilities.tool.uuid.label',
    descriptionKey: 'utilities.tool.uuid.description',
    keywords: ['uuid', 'guid', 'identifier', 'random'],
    detect: ({ primary }) => detectsAsUuid(primary),
  },
  {
    id: 'hash',
    titleKey: 'utilities.tool.hash.titleLabel',
    actionLabelKey: 'utilities.tool.hash.label',
    descriptionKey: 'utilities.tool.hash.description',
    keywords: ['hash', 'sha1', 'sha256', 'digest'],
    aliases: ['md5', 'hmac'],
    detect: ({ primary }) => detectsAsHashable(primary),
  },
  {
    id: 'timestamp',
    titleKey: 'utilities.tool.timestamp.titleLabel',
    actionLabelKey: 'utilities.tool.timestamp.label',
    descriptionKey: 'utilities.tool.timestamp.description',
    keywords: ['timestamp', 'unix', 'date', 'time'],
    aliases: ['ts', 'epoch'],
    detect: ({ primary }) => detectsAsTimestamp(primary),
  },
  {
    id: 'jwt',
    titleKey: 'utilities.tool.jwt.titleLabel',
    actionLabelKey: 'utilities.tool.jwt.label',
    descriptionKey: 'utilities.tool.jwt.description',
    keywords: ['jwt', 'token', 'decode', 'claims'],
    aliases: ['bearer'],
    detect: ({ primary }) => detectsAsJwt(primary),
  },
  {
    id: 'regex',
    titleKey: 'utilities.tool.regex.titleLabel',
    actionLabelKey: 'utilities.tool.regex.label',
    descriptionKey: 'utilities.tool.regex.description',
    keywords: ['regex', 'regexp', 'pattern', 'match', 'capture'],
    aliases: ['re'],
    detect: ({ primary, secondary }) => detectsAsRegex(primary) && (secondary ?? '').length > 0,
  },
  {
    id: 'color',
    titleKey: 'utilities.tool.color.titleLabel',
    actionLabelKey: 'utilities.tool.color.label',
    descriptionKey: 'utilities.tool.color.description',
    keywords: ['color', 'hex', 'rgb', 'hsl', 'palette', 'convert'],
    detect: ({ primary }) => detectsAsColor(primary),
  },
  {
    id: 'diff',
    titleKey: 'utilities.tool.diff.titleLabel',
    actionLabelKey: 'utilities.tool.diff.label',
    descriptionKey: 'utilities.tool.diff.description',
    keywords: ['diff', 'compare', 'text', 'changes'],
    detect: ({ primary, secondary }) => primary.length > 0 && (secondary ?? '').length > 0,
  },
  {
    id: 'number-base',
    titleKey: 'utilities.tool.numberBase.titleLabel',
    actionLabelKey: 'utilities.tool.numberBase.label',
    descriptionKey: 'utilities.tool.numberBase.description',
    keywords: ['number', 'base', 'binary', 'hex', 'octal', 'decimal', 'radix', 'convert'],
    detect: ({ primary }) => detectsAsNumber(primary),
  },
  {
    id: 'beautify-minify',
    titleKey: 'utilities.tool.beautifyMinify.titleLabel',
    actionLabelKey: 'utilities.tool.beautifyMinify.label',
    descriptionKey: 'utilities.tool.beautifyMinify.description',
    keywords: ['beautify', 'minify', 'format', 'pretty', 'json', 'javascript', 'js'],
    aliases: ['min'],
    detect: ({ primary }) => detectsAsBeautifiable(primary),
  },
  {
    id: 'string-case',
    titleKey: 'utilities.tool.stringCase.titleLabel',
    actionLabelKey: 'utilities.tool.stringCase.label',
    descriptionKey: 'utilities.tool.stringCase.description',
    keywords: ['case', 'camel', 'snake', 'kebab', 'pascal', 'constant', 'title', 'sentence'],
    detect: ({ primary }) => detectsAsCaseConvertible(primary),
  },
  {
    id: 'html-entity',
    titleKey: 'utilities.tool.htmlEntity.titleLabel',
    actionLabelKey: 'utilities.tool.htmlEntity.label',
    descriptionKey: 'utilities.tool.htmlEntity.description',
    keywords: ['html', 'entity', 'escape', 'ampersand', 'encode', 'decode'],
    detect: ({ primary }) => detectsAsHtmlEntity(primary),
  },
  {
    id: 'string-inspector',
    titleKey: 'utilities.tool.stringInspector.titleLabel',
    actionLabelKey: 'utilities.tool.stringInspector.label',
    descriptionKey: 'utilities.tool.stringInspector.description',
    keywords: ['unicode', 'codepoint', 'bytes', 'invisible', 'zero-width', 'bidi', 'homoglyph'],
    aliases: ['inspector'],
    detect: ({ primary }) => detectsAsInspectableText(primary),
  },
  {
    id: 'qr-code',
    titleKey: 'utilities.tool.qrCode.titleLabel',
    actionLabelKey: 'utilities.tool.qrCode.label',
    descriptionKey: 'utilities.tool.qrCode.description',
    keywords: ['qr', 'qrcode', 'barcode', 'payload', 'scanner', 'url', 'share'],
    detect: ({ primary }) => primary.trim().length > 0,
  },
  {
    id: 'backslash-escape',
    titleKey: 'utilities.tool.backslashEscape.titleLabel',
    actionLabelKey: 'utilities.tool.backslashEscape.label',
    descriptionKey: 'utilities.tool.backslashEscape.description',
    keywords: [
      'backslash',
      'escape',
      'unescape',
      'string',
      'javascript',
      'json',
      'python',
      'sql',
      'mysql',
    ],
    detect: ({ primary }) => detectsAsBackslashEscaped(primary),
  },
  {
    id: 'random-string',
    titleKey: 'utilities.tool.randomString.titleLabel',
    actionLabelKey: 'utilities.tool.randomString.label',
    descriptionKey: 'utilities.tool.randomString.description',
    keywords: [
      'random',
      'string',
      'password',
      'token',
      'secret',
      'mock',
      'generate',
      'charset',
      'secure',
    ],
    // RL-069 Slice 2 — pure generator. No `detect`; the toolbar hides
    // the ⚡ Apply button so the existing "Generate" control stays
    // the single canonical action.
  },
  {
    id: 'mock-data',
    titleKey: 'utilities.tool.mockData.titleLabel',
    actionLabelKey: 'utilities.tool.mockData.label',
    descriptionKey: 'utilities.tool.mockData.description',
    keywords: [
      'mock',
      'fake',
      'faker',
      'sample',
      'seed',
      'fixture',
      'dataset',
      'json',
      'csv',
      'ndjson',
      'generate',
      'test data',
    ],
    // Pure generator. No `detect`; the toolbar hides the ⚡ Apply button
    // so the "Generate" control stays the single canonical action.
  },
  {
    id: 'base64-image',
    titleKey: 'utilities.tool.base64Image.titleLabel',
    actionLabelKey: 'utilities.tool.base64Image.label',
    descriptionKey: 'utilities.tool.base64Image.description',
    keywords: ['base64', 'image', 'data-uri', 'png', 'jpeg', 'svg', 'encode', 'decode', 'preview'],
    detect: ({ primary }) => detectsAsDataUri(primary),
  },
  {
    id: 'lorem-ipsum',
    titleKey: 'utilities.tool.loremIpsum.titleLabel',
    actionLabelKey: 'utilities.tool.loremIpsum.label',
    descriptionKey: 'utilities.tool.loremIpsum.description',
    keywords: ['lorem', 'ipsum', 'placeholder', 'dummy', 'mock', 'copy', 'text', 'latin'],
    aliases: ['lipsum'],
    // RL-069 Slice 2 — pure generator. No `detect`; the toolbar hides
    // the ⚡ Apply button so the existing "Generate" control stays
    // the single canonical action.
  },
  {
    id: 'svg-to-css',
    titleKey: 'utilities.tool.svgToCss.titleLabel',
    actionLabelKey: 'utilities.tool.svgToCss.label',
    descriptionKey: 'utilities.tool.svgToCss.description',
    keywords: [
      'svg',
      'css',
      'background',
      'background-image',
      'data-uri',
      'data-url',
      'encode',
      'image',
      'icon',
    ],
    aliases: ['svg2css'],
    detect: ({ primary }) => detectsAsSvg(primary),
  },
  {
    id: 'cron-parser',
    titleKey: 'utilities.tool.cron.titleLabel',
    actionLabelKey: 'utilities.tool.cron.label',
    descriptionKey: 'utilities.tool.cron.description',
    keywords: [
      'cron',
      'crontab',
      'schedule',
      'job',
      'timer',
      'next',
      'runs',
      'quartz',
      'expression',
    ],
    detect: ({ primary }) => detectsAsCron(primary),
  },
  {
    id: 'html-to-jsx',
    titleKey: 'utilities.tool.htmlToJsx.titleLabel',
    actionLabelKey: 'utilities.tool.htmlToJsx.label',
    descriptionKey: 'utilities.tool.htmlToJsx.description',
    keywords: ['html', 'jsx', 'react', 'convert', 'migrate', 'component', 'classname'],
    aliases: ['html2jsx'],
    detect: ({ primary }) => detectsAsHtml(primary),
  },
  {
    id: 'curl-to-code',
    titleKey: 'utilities.tool.curlToCode.titleLabel',
    actionLabelKey: 'utilities.tool.curlToCode.label',
    descriptionKey: 'utilities.tool.curlToCode.description',
    keywords: [
      'curl',
      'fetch',
      'undici',
      'requests',
      'net-http',
      'http',
      'request',
      'convert',
      'code',
      'python',
      'go',
      'javascript',
    ],
    aliases: ['curl2code'],
    detect: ({ primary }) => detectsAsCurl(primary),
  },
  {
    id: 'yaml-json',
    titleKey: 'utilities.tool.yamlJson.titleLabel',
    actionLabelKey: 'utilities.tool.yamlJson.label',
    descriptionKey: 'utilities.tool.yamlJson.description',
    keywords: ['yaml', 'json', 'convert', 'parse', 'dump', 'serialize', 'config'],
    aliases: ['y2j', 'j2y'],
    detect: ({ primary }) => detectsAsJson(primary) || detectsAsYaml(primary),
  },
  {
    id: 'json-csv',
    titleKey: 'utilities.tool.jsonCsv.titleLabel',
    actionLabelKey: 'utilities.tool.jsonCsv.label',
    descriptionKey: 'utilities.tool.jsonCsv.description',
    keywords: ['json', 'csv', 'convert', 'tsv', 'export', 'spreadsheet', 'rfc-4180'],
    aliases: ['j2c', 'c2j'],
    detect: ({ primary }) => detectsAsJson(primary) || detectsAsCsv(primary),
  },
  {
    id: 'markdown-preview',
    titleKey: 'utilities.tool.markdownPreview.titleLabel',
    actionLabelKey: 'utilities.tool.markdownPreview.label',
    descriptionKey: 'utilities.tool.markdownPreview.description',
    // RL-069 Slice 1 — `md` moved from keywords to aliases so it
    // serves as a fuzzy-search shorthand without duplicating the
    // descriptive-keyword vocabulary.
    keywords: ['markdown', 'preview', 'gfm', 'render', 'docs', 'readme'],
    aliases: ['md'],
    detect: ({ primary }) => detectsAsMarkdown(primary),
  },
  {
    id: 'sql-formatter',
    titleKey: 'utilities.tool.sqlFormatter.titleLabel',
    actionLabelKey: 'utilities.tool.sqlFormatter.label',
    descriptionKey: 'utilities.tool.sqlFormatter.description',
    keywords: ['sql', 'format', 'beautify', 'mysql', 'postgresql', 'ansi', 'database'],
    aliases: ['sqlfmt'],
    detect: ({ primary }) => detectsAsSql(primary),
  },
  {
    // RL-099 Slice 1 — Utility Pipelines. Composes existing
    // utility adapters into a one-click chained workflow. No
    // `detect` predicate: the panel takes a free-form text input
    // and pipes it through user-defined steps.
    id: 'utility-pipelines',
    titleKey: 'utilities.tool.utilityPipelines.titleLabel',
    actionLabelKey: 'utilities.tool.utilityPipelines.label',
    descriptionKey: 'utilities.tool.utilityPipelines.description',
    keywords: ['pipeline', 'chain', 'compose', 'recipe', 'workflow', 'sequence'],
    aliases: ['pipe', 'flow'],
    requiresEntitlement: 'DEV_UTILITIES',
  },
] as const;

export function findDeveloperUtility(id: DeveloperUtilityId): DeveloperUtilityDefinition {
  const fallbackUtility = DEVELOPER_UTILITIES[0];
  if (!fallbackUtility) {
    throw new Error('Developer utilities catalog is empty.');
  }

  return DEVELOPER_UTILITIES.find(utility => utility.id === id) ?? fallbackUtility;
}
