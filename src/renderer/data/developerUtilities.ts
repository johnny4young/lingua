export type DeveloperUtilityId =
  | 'json'
  | 'base64'
  | 'url'
  | 'uuid'
  | 'hash'
  | 'timestamp'
  | 'jwt'
  | 'regex'
  | 'color'
  | 'diff'
  | 'number-base'
  | 'beautify-minify';

export interface DeveloperUtilityDefinition {
  id: DeveloperUtilityId;
  titleKey: string;
  actionLabelKey: string;
  descriptionKey: string;
  keywords: string[];
}

export const DEFAULT_DEVELOPER_UTILITY_ID: DeveloperUtilityId = 'json';

export const DEVELOPER_UTILITIES: readonly DeveloperUtilityDefinition[] = [
  {
    id: 'json',
    titleKey: 'utilities.tool.json.titleLabel',
    actionLabelKey: 'utilities.tool.json.label',
    descriptionKey: 'utilities.tool.json.description',
    keywords: ['json', 'format', 'validate', 'viewer', 'pretty'],
  },
  {
    id: 'base64',
    titleKey: 'utilities.tool.base64.titleLabel',
    actionLabelKey: 'utilities.tool.base64.label',
    descriptionKey: 'utilities.tool.base64.description',
    keywords: ['base64', 'encode', 'decode'],
  },
  {
    id: 'url',
    titleKey: 'utilities.tool.url.titleLabel',
    actionLabelKey: 'utilities.tool.url.label',
    descriptionKey: 'utilities.tool.url.description',
    keywords: ['url', 'encode', 'decode', 'querystring'],
  },
  {
    id: 'uuid',
    titleKey: 'utilities.tool.uuid.titleLabel',
    actionLabelKey: 'utilities.tool.uuid.label',
    descriptionKey: 'utilities.tool.uuid.description',
    keywords: ['uuid', 'guid', 'identifier', 'random'],
  },
  {
    id: 'hash',
    titleKey: 'utilities.tool.hash.titleLabel',
    actionLabelKey: 'utilities.tool.hash.label',
    descriptionKey: 'utilities.tool.hash.description',
    keywords: ['hash', 'sha1', 'sha256', 'digest'],
  },
  {
    id: 'timestamp',
    titleKey: 'utilities.tool.timestamp.titleLabel',
    actionLabelKey: 'utilities.tool.timestamp.label',
    descriptionKey: 'utilities.tool.timestamp.description',
    keywords: ['timestamp', 'unix', 'date', 'time'],
  },
  {
    id: 'jwt',
    titleKey: 'utilities.tool.jwt.titleLabel',
    actionLabelKey: 'utilities.tool.jwt.label',
    descriptionKey: 'utilities.tool.jwt.description',
    keywords: ['jwt', 'token', 'decode', 'claims'],
  },
  {
    id: 'regex',
    titleKey: 'utilities.tool.regex.titleLabel',
    actionLabelKey: 'utilities.tool.regex.label',
    descriptionKey: 'utilities.tool.regex.description',
    keywords: ['regex', 'regexp', 'pattern', 'match', 'capture'],
  },
  {
    id: 'color',
    titleKey: 'utilities.tool.color.titleLabel',
    actionLabelKey: 'utilities.tool.color.label',
    descriptionKey: 'utilities.tool.color.description',
    keywords: ['color', 'hex', 'rgb', 'hsl', 'palette', 'convert'],
  },
  {
    id: 'diff',
    titleKey: 'utilities.tool.diff.titleLabel',
    actionLabelKey: 'utilities.tool.diff.label',
    descriptionKey: 'utilities.tool.diff.description',
    keywords: ['diff', 'compare', 'text', 'changes'],
  },
  {
    id: 'number-base',
    titleKey: 'utilities.tool.numberBase.titleLabel',
    actionLabelKey: 'utilities.tool.numberBase.label',
    descriptionKey: 'utilities.tool.numberBase.description',
    keywords: ['number', 'base', 'binary', 'hex', 'octal', 'decimal', 'radix', 'convert'],
  },
  {
    id: 'beautify-minify',
    titleKey: 'utilities.tool.beautifyMinify.titleLabel',
    actionLabelKey: 'utilities.tool.beautifyMinify.label',
    descriptionKey: 'utilities.tool.beautifyMinify.description',
    keywords: ['beautify', 'minify', 'format', 'pretty', 'json', 'javascript', 'js'],
  },
] as const;

export function findDeveloperUtility(
  id: DeveloperUtilityId
): DeveloperUtilityDefinition {
  const fallbackUtility = DEVELOPER_UTILITIES[0];
  if (!fallbackUtility) {
    throw new Error('Developer utilities catalog is empty.');
  }

  return DEVELOPER_UTILITIES.find((utility) => utility.id === id) ?? fallbackUtility;
}
