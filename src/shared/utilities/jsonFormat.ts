/**
 * implementation — `json-format` adapter.
 *
 * Pretty-prints (or minifies) a JSON document. Thin wrapper around
 * the existing `analyzeJson` helper in
 * `src/renderer/utils/developerUtilities.ts` — kept pure here so the
 * pipeline engine + CLI (future implementation) can import without
 * dragging React or renderer-only deps.
 */

import type { UtilityAdapter } from './types';

const INDENT_OPTIONS = ['minified', '2', '4'] as const;
type IndentMode = (typeof INDENT_OPTIONS)[number];

export interface JsonFormatOptions {
  /** Output style. `'2'` and `'4'` are spaces-per-indent; `'minified'` strips whitespace. */
  indent: IndentMode;
}

function isIndentMode(value: unknown): value is IndentMode {
  return (
    typeof value === 'string' && (INDENT_OPTIONS as readonly string[]).includes(value)
  );
}

export const jsonFormatAdapter: UtilityAdapter<JsonFormatOptions> = {
  id: 'json-format',
  titleKey: 'utilityPipeline.adapter.jsonFormat.title',
  descriptionKey: 'utilityPipeline.adapter.jsonFormat.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [
    {
      key: 'indent',
      type: 'select',
      labelKey: 'utilityPipeline.adapter.jsonFormat.options.indent',
      options: [
        { value: '2', labelKey: 'utilityPipeline.adapter.jsonFormat.options.indent.2' },
        { value: '4', labelKey: 'utilityPipeline.adapter.jsonFormat.options.indent.4' },
        {
          value: 'minified',
          labelKey: 'utilityPipeline.adapter.jsonFormat.options.indent.minified',
        },
      ],
      defaultValue: '2',
    },
  ],
  defaultOptions: () => ({ indent: '2' }),
  parseOptions: (raw): JsonFormatOptions | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (!isIndentMode(record.indent)) return null;
    return { indent: record.indent };
  },
  run: async (input, options) => {
    if (input.trim().length === 0) {
      return { ok: true, value: '' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch (err) {
      return {
        ok: false,
        reason: 'invalid-input',
        detail: err instanceof Error ? err.message : String(err ?? 'invalid JSON'),
      };
    }
    try {
      const spaces = options.indent === 'minified' ? 0 : Number(options.indent);
      const value =
        options.indent === 'minified'
          ? JSON.stringify(parsed)
          : JSON.stringify(parsed, null, spaces);
      return { ok: true, value };
    } catch (err) {
      return {
        ok: false,
        reason: 'execution-error',
        detail: err instanceof Error ? err.message : 'stringify failed',
      };
    }
  },
};
