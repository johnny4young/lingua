import {
  DEFAULT_DEVELOPER_UTILITY_ID,
  DEVELOPER_UTILITY_CATALOG,
  type DeveloperUtilityCatalogEntry,
  type DeveloperUtilityId,
} from './developerUtilityCatalog';

export { DEFAULT_DEVELOPER_UTILITY_ID, type DeveloperUtilityId };

/**
 * Search and presentation metadata for developer utility reference surfaces.
 *
 * This module loads with the lazy Command Palette or Utilities workspace.
 * Startup consumers must use developerUtilityCatalog.ts instead so descriptive
 * copy and fuzzy-search tokens do not join every workspace boot.
 */
interface DeveloperUtilityReferenceMetadata {
  readonly actionLabelKey: string;
  readonly descriptionKey: string;
  readonly keywords: readonly string[];
  readonly aliases?: readonly string[];
}

export interface DeveloperUtilityDefinition
  extends DeveloperUtilityCatalogEntry, DeveloperUtilityReferenceMetadata {}

const DEVELOPER_UTILITY_REFERENCE_METADATA: Record<
  DeveloperUtilityId,
  DeveloperUtilityReferenceMetadata
> = {
  json: {
    actionLabelKey: 'utilities.tool.json.label',
    descriptionKey: 'utilities.tool.json.description',
    keywords: ['json', 'format', 'validate', 'viewer', 'pretty'],
  },
  base64: {
    actionLabelKey: 'utilities.tool.base64.label',
    descriptionKey: 'utilities.tool.base64.description',
    keywords: ['base64', 'encode', 'decode'],
    aliases: ['b64'],
  },
  url: {
    actionLabelKey: 'utilities.tool.url.label',
    descriptionKey: 'utilities.tool.url.description',
    keywords: ['url', 'encode', 'decode', 'querystring'],
  },
  'url-parser': {
    actionLabelKey: 'utilities.tool.urlParser.label',
    descriptionKey: 'utilities.tool.urlParser.description',
    keywords: ['url', 'parse', 'host', 'query', 'path', 'inspect'],
  },
  uuid: {
    actionLabelKey: 'utilities.tool.uuid.label',
    descriptionKey: 'utilities.tool.uuid.description',
    keywords: ['uuid', 'guid', 'identifier', 'random'],
  },
  hash: {
    actionLabelKey: 'utilities.tool.hash.label',
    descriptionKey: 'utilities.tool.hash.description',
    keywords: ['hash', 'sha1', 'sha256', 'digest'],
    aliases: ['md5', 'hmac'],
  },
  timestamp: {
    actionLabelKey: 'utilities.tool.timestamp.label',
    descriptionKey: 'utilities.tool.timestamp.description',
    keywords: ['timestamp', 'unix', 'date', 'time'],
    aliases: ['ts', 'epoch'],
  },
  jwt: {
    actionLabelKey: 'utilities.tool.jwt.label',
    descriptionKey: 'utilities.tool.jwt.description',
    keywords: ['jwt', 'token', 'decode', 'claims'],
    aliases: ['bearer'],
  },
  regex: {
    actionLabelKey: 'utilities.tool.regex.label',
    descriptionKey: 'utilities.tool.regex.description',
    keywords: ['regex', 'regexp', 'pattern', 'match', 'capture'],
    aliases: ['re'],
  },
  color: {
    actionLabelKey: 'utilities.tool.color.label',
    descriptionKey: 'utilities.tool.color.description',
    keywords: ['color', 'hex', 'rgb', 'hsl', 'palette', 'convert'],
  },
  diff: {
    actionLabelKey: 'utilities.tool.diff.label',
    descriptionKey: 'utilities.tool.diff.description',
    keywords: ['diff', 'compare', 'text', 'changes'],
  },
  'number-base': {
    actionLabelKey: 'utilities.tool.numberBase.label',
    descriptionKey: 'utilities.tool.numberBase.description',
    keywords: ['number', 'base', 'binary', 'hex', 'octal', 'decimal', 'radix', 'convert'],
  },
  'beautify-minify': {
    actionLabelKey: 'utilities.tool.beautifyMinify.label',
    descriptionKey: 'utilities.tool.beautifyMinify.description',
    keywords: ['beautify', 'minify', 'format', 'pretty', 'json', 'javascript', 'js'],
    aliases: ['min'],
  },
  'string-case': {
    actionLabelKey: 'utilities.tool.stringCase.label',
    descriptionKey: 'utilities.tool.stringCase.description',
    keywords: ['case', 'camel', 'snake', 'kebab', 'pascal', 'constant', 'title', 'sentence'],
  },
  'html-entity': {
    actionLabelKey: 'utilities.tool.htmlEntity.label',
    descriptionKey: 'utilities.tool.htmlEntity.description',
    keywords: ['html', 'entity', 'escape', 'ampersand', 'encode', 'decode'],
  },
  'string-inspector': {
    actionLabelKey: 'utilities.tool.stringInspector.label',
    descriptionKey: 'utilities.tool.stringInspector.description',
    keywords: ['unicode', 'codepoint', 'bytes', 'invisible', 'zero-width', 'bidi', 'homoglyph'],
    aliases: ['inspector'],
  },
  'qr-code': {
    actionLabelKey: 'utilities.tool.qrCode.label',
    descriptionKey: 'utilities.tool.qrCode.description',
    keywords: ['qr', 'qrcode', 'barcode', 'payload', 'scanner', 'url', 'share'],
  },
  'backslash-escape': {
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
  },
  'random-string': {
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
  },
  'mock-data': {
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
  },
  'base64-image': {
    actionLabelKey: 'utilities.tool.base64Image.label',
    descriptionKey: 'utilities.tool.base64Image.description',
    keywords: ['base64', 'image', 'data-uri', 'png', 'jpeg', 'svg', 'encode', 'decode', 'preview'],
  },
  'lorem-ipsum': {
    actionLabelKey: 'utilities.tool.loremIpsum.label',
    descriptionKey: 'utilities.tool.loremIpsum.description',
    keywords: ['lorem', 'ipsum', 'placeholder', 'dummy', 'mock', 'copy', 'text', 'latin'],
    aliases: ['lipsum'],
  },
  'svg-to-css': {
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
  },
  'cron-parser': {
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
  },
  'html-to-jsx': {
    actionLabelKey: 'utilities.tool.htmlToJsx.label',
    descriptionKey: 'utilities.tool.htmlToJsx.description',
    keywords: ['html', 'jsx', 'react', 'convert', 'migrate', 'component', 'classname'],
    aliases: ['html2jsx'],
  },
  'curl-to-code': {
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
  },
  'yaml-json': {
    actionLabelKey: 'utilities.tool.yamlJson.label',
    descriptionKey: 'utilities.tool.yamlJson.description',
    keywords: ['yaml', 'json', 'convert', 'parse', 'dump', 'serialize', 'config'],
    aliases: ['y2j', 'j2y'],
  },
  'json-csv': {
    actionLabelKey: 'utilities.tool.jsonCsv.label',
    descriptionKey: 'utilities.tool.jsonCsv.description',
    keywords: ['json', 'csv', 'convert', 'tsv', 'export', 'spreadsheet', 'rfc-4180'],
    aliases: ['j2c', 'c2j'],
  },
  'markdown-preview': {
    actionLabelKey: 'utilities.tool.markdownPreview.label',
    descriptionKey: 'utilities.tool.markdownPreview.description',
    keywords: ['markdown', 'preview', 'gfm', 'render', 'docs', 'readme'],
    aliases: ['md'],
  },
  'sql-formatter': {
    actionLabelKey: 'utilities.tool.sqlFormatter.label',
    descriptionKey: 'utilities.tool.sqlFormatter.description',
    keywords: ['sql', 'format', 'beautify', 'mysql', 'postgresql', 'ansi', 'database'],
    aliases: ['sqlfmt'],
  },
  'utility-pipelines': {
    actionLabelKey: 'utilities.tool.utilityPipelines.label',
    descriptionKey: 'utilities.tool.utilityPipelines.description',
    keywords: ['pipeline', 'chain', 'compose', 'recipe', 'workflow', 'sequence'],
    aliases: ['pipe', 'flow'],
  },
};

export const DEVELOPER_UTILITIES: readonly DeveloperUtilityDefinition[] =
  DEVELOPER_UTILITY_CATALOG.map(utility => ({
    ...utility,
    ...DEVELOPER_UTILITY_REFERENCE_METADATA[utility.id],
  }));

export function findDeveloperUtility(id: DeveloperUtilityId): DeveloperUtilityDefinition {
  const fallbackUtility = DEVELOPER_UTILITIES[0];
  if (!fallbackUtility) {
    throw new Error('Developer utilities catalog is empty.');
  }

  return DEVELOPER_UTILITIES.find(utility => utility.id === id) ?? fallbackUtility;
}
