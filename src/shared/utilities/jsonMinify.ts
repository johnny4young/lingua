/**
 * RL-099 Slice 6 fold B — `json-minify` adapter.
 *
 * The compaction counterpart to the `json-format` prettifier: parse
 * the input as JSON and re-emit it with no insignificant whitespace
 * (`JSON.stringify(value)`), so a chain can transform → minify → copy.
 * Pure shared implementation; no options. Malformed JSON settles as
 * `invalid-input` with the parser message in `detail` (dev-facing,
 * not user copy).
 */

import type { UtilityAdapter } from './types';

/** `json-minify` takes no options. */
export type JsonMinifyOptions = Record<string, never>;

function parseEmptyOptions(raw: unknown): JsonMinifyOptions | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {};
}

export const jsonMinifyAdapter: UtilityAdapter<JsonMinifyOptions> = {
  id: 'json-minify',
  titleKey: 'utilityPipeline.adapter.jsonMinify.title',
  descriptionKey: 'utilityPipeline.adapter.jsonMinify.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [],
  defaultOptions: () => ({}),
  parseOptions: parseEmptyOptions,
  run: async (input) => {
    if (input.trim() === '') {
      return { ok: false, reason: 'invalid-input', detail: 'empty input' };
    }
    try {
      return { ok: true, value: JSON.stringify(JSON.parse(input)) };
    } catch (error) {
      return {
        ok: false,
        reason: 'invalid-input',
        detail: error instanceof Error ? error.message : 'invalid JSON',
      };
    }
  },
};
