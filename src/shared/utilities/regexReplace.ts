/**
 * implementation — `regex-replace` adapter.
 *
 * Thin port of the renderer's `applyRegexReplace` helper. Takes a
 * pattern + flags + replacement and runs them against the chained
 * input. Match-count cap mirrors the renderer panel (10 000 matches)
 * so a pathological pipeline doesn't lock the renderer thread.
 */

import type { UtilityAdapter } from './types';

const REGEX_MATCH_LIMIT = 10_000;

export interface RegexReplaceOptions {
  pattern: string;
  flags: string;
  replacement: string;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export const regexReplaceAdapter: UtilityAdapter<RegexReplaceOptions> = {
  id: 'regex-replace',
  titleKey: 'utilityPipeline.adapter.regexReplace.title',
  descriptionKey: 'utilityPipeline.adapter.regexReplace.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [
    {
      key: 'pattern',
      type: 'text',
      labelKey: 'utilityPipeline.adapter.regexReplace.options.pattern',
      placeholderKey: 'utilityPipeline.adapter.regexReplace.options.patternPlaceholder',
      defaultValue: '',
    },
    {
      key: 'flags',
      type: 'text',
      labelKey: 'utilityPipeline.adapter.regexReplace.options.flags',
      placeholderKey: 'utilityPipeline.adapter.regexReplace.options.flagsPlaceholder',
      defaultValue: 'g',
    },
    {
      key: 'replacement',
      type: 'text',
      labelKey: 'utilityPipeline.adapter.regexReplace.options.replacement',
      placeholderKey: 'utilityPipeline.adapter.regexReplace.options.replacementPlaceholder',
      defaultValue: '',
    },
  ],
  defaultOptions: () => ({ pattern: '', flags: 'g', replacement: '' }),
  parseOptions: (raw): RegexReplaceOptions | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (!isString(record.pattern)) return null;
    if (!isString(record.flags)) return null;
    if (!isString(record.replacement)) return null;
    return {
      pattern: record.pattern,
      flags: record.flags,
      replacement: record.replacement,
    };
  },
  run: async (input, options) => {
    if (options.pattern.length === 0) {
      return { ok: true, value: input };
    }
    let regex: RegExp;
    try {
      regex = new RegExp(options.pattern, options.flags);
    } catch (err) {
      return {
        ok: false,
        reason: 'invalid-options',
        detail: err instanceof Error ? err.message : 'invalid pattern or flags',
      };
    }
    try {
      // Defensive match-count cap — `replace` itself doesn't iterate
      // beyond what the regex matches, but we expose `truncated` to
      // the engine via a non-failing path: just run replace.
      if (regex.global) {
        let count = 0;
        const iterator = input.matchAll(regex);
        while (!iterator.next().done) {
          count += 1;
          if (count > REGEX_MATCH_LIMIT) {
            return {
              ok: false,
              reason: 'execution-error',
              detail: `Match count exceeded ${REGEX_MATCH_LIMIT.toLocaleString()} cap`,
            };
          }
        }
      }
      const value = input.replace(regex, options.replacement);
      return { ok: true, value };
    } catch (err) {
      return {
        ok: false,
        reason: 'execution-error',
        detail: err instanceof Error ? err.message : 'regex execution failed',
      };
    }
  },
};
