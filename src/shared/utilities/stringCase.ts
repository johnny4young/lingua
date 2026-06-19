/**
 * RL-099 Slice 4 fold C — `string-case` adapter.
 *
 * Re-cases the input to a chosen convention (lower / upper / title /
 * camel / snake / kebab). Pure shared implementation: the single-shot
 * string-case panel keeps its own logic inline, so this is an
 * independent reimplementation (the shared layer cannot import the
 * renderer). Tokenizes on whitespace, `_`, `-`, and camelCase
 * boundaries, then rejoins per the target convention.
 */

import type { UtilityAdapter, UtilityOptionField } from './types';

/** Target case conventions surfaced as the `target` option. */
export const STRING_CASE_TARGETS = [
  'lower',
  'upper',
  'title',
  'camel',
  'snake',
  'kebab',
] as const;
export type StringCaseTarget = (typeof STRING_CASE_TARGETS)[number];

/** Structured options for the `string-case` adapter. */
export interface StringCaseOptions {
  readonly target: StringCaseTarget;
}

const TARGET_SET: ReadonlySet<string> = new Set(STRING_CASE_TARGETS);

const TARGET_OPTION: UtilityOptionField = {
  key: 'target',
  type: 'select',
  labelKey: 'utilityPipeline.adapter.stringCase.options.target.label',
  defaultValue: 'camel',
  options: STRING_CASE_TARGETS.map((target) => ({
    value: target,
    labelKey: `utilityPipeline.adapter.stringCase.options.target.${target}`,
  })),
};

/** Split an arbitrary string into lowercase word tokens. */
function tokenize(input: string): string[] {
  return input
    // camelCase / PascalCase boundary → space
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    // ACRONYMFollowed boundary (e.g. JSONData → JSON Data)
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    // separators → space
    .replace(/[_\-/.]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
}

function capitalize(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1);
}

function recase(tokens: string[], target: StringCaseTarget): string {
  switch (target) {
    case 'lower':
      return tokens.join(' ');
    case 'upper':
      return tokens.join(' ').toUpperCase();
    case 'title':
      return tokens.map(capitalize).join(' ');
    case 'camel':
      return tokens
        .map((token, index) => (index === 0 ? token : capitalize(token)))
        .join('');
    case 'snake':
      return tokens.join('_');
    case 'kebab':
      return tokens.join('-');
    default:
      return tokens.join(' ');
  }
}

export const stringCaseAdapter: UtilityAdapter<StringCaseOptions> = {
  id: 'string-case',
  titleKey: 'utilityPipeline.adapter.stringCase.title',
  descriptionKey: 'utilityPipeline.adapter.stringCase.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [TARGET_OPTION],
  defaultOptions: () => ({ target: 'camel' }),
  parseOptions: (raw) => {
    if (raw === undefined || raw === null) return { target: 'camel' };
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    const candidate = (raw as { target?: unknown }).target;
    if (candidate === undefined) return { target: 'camel' };
    if (typeof candidate !== 'string' || !TARGET_SET.has(candidate)) {
      return null;
    }
    return { target: candidate as StringCaseTarget };
  },
  run: async (input, options) => {
    const tokens = tokenize(input);
    return { ok: true, value: recase(tokens, options.target) };
  },
};
