/**
 * implementation note — `text-stats` adapter.
 *
 * A terminal "inspect" step: report line / word / character / byte
 * counts for the input. Pure shared implementation; no options.
 *
 * Output is fixed-label data (not UI chrome), the same way `timestamp`
 * emits ISO strings and `hash` emits hex — it is the adapter's
 * computed result, not localized product copy, so it is rendered in
 * the result `<pre>` verbatim and stays `text` kind so a later step
 * can still consume it. Counting rules: lines = newline-delimited
 * segments (0 for empty input); words = whitespace-delimited
 * non-empty tokens; characters = Unicode code points; bytes = UTF-8
 * byte length.
 */

import type { UtilityAdapter } from './types';

/** `text-stats` takes no options. */
export type TextStatsOptions = Record<string, never>;

const ENCODER = new TextEncoder();

function parseEmptyOptions(raw: unknown): TextStatsOptions | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {};
}

export const textStatsAdapter: UtilityAdapter<TextStatsOptions> = {
  id: 'text-stats',
  titleKey: 'utilityPipeline.adapter.textStats.title',
  descriptionKey: 'utilityPipeline.adapter.textStats.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [],
  defaultOptions: () => ({}),
  parseOptions: parseEmptyOptions,
  run: async (input) => {
    const lines = input === '' ? 0 : input.split(/\r\n|\r|\n/u).length;
    const words = input.trim() === '' ? 0 : input.trim().split(/\s+/u).length;
    const characters = [...input].length;
    const bytes = ENCODER.encode(input).length;
    const value = [
      `Lines: ${lines}`,
      `Words: ${words}`,
      `Characters: ${characters}`,
      `Bytes: ${bytes}`,
    ].join('\n');
    return { ok: true, value };
  },
};
