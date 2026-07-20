/**
 * implementation — `url-encode` + `url-decode` adapters.
 *
 * Percent-encode / decode the input as a URL COMPONENT (distinct from
 * the `url-parse` adapter, which parses a full URL's query string).
 * Pure wrappers over the platform `encodeURIComponent` /
 * `decodeURIComponent`; `decode` surfaces a malformed `%`-sequence as
 * `invalid-input` instead of throwing. These are the shared source of
 * truth — the renderer's `developerUtilities.ts` re-exports them (fold
 * F) so the single-shot URL panel and the pipeline share one impl.
 */

import type { UtilityAdapter } from './types';

/** No options — encode/decode are deterministic. */
export type UrlComponentOptions = Record<string, never>;

function parseEmptyOptions(raw: unknown): UrlComponentOptions | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {};
}

/**
 * Percent-encode a string as a URL component. `encodeURIComponent`
 * throws a `URIError` on a lone UTF-16 surrogate, so this is the one
 * encode path that can fail; callers that need a typed outcome wrap it
 * (see `urlEncodeAdapter`).
 */
export function encodeUrlComponent(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Decode a percent-encoded URL component. Returns `null` on a malformed
 * `%`-sequence (where `decodeURIComponent` throws a `URIError`).
 */
export function decodeUrlComponentSafe(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export const urlEncodeAdapter: UtilityAdapter<UrlComponentOptions> = {
  id: 'url-encode',
  titleKey: 'utilityPipeline.adapter.urlEncode.title',
  descriptionKey: 'utilityPipeline.adapter.urlEncode.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [],
  defaultOptions: () => ({}),
  parseOptions: parseEmptyOptions,
  run: async (input) => {
    try {
      // `encodeURIComponent` throws a URIError on a lone surrogate.
      return { ok: true, value: encodeUrlComponent(input) };
    } catch (err) {
      return {
        ok: false,
        reason: 'invalid-input',
        detail: err instanceof Error ? err.message : 'invalid input',
      };
    }
  },
};

export const urlDecodeAdapter: UtilityAdapter<UrlComponentOptions> = {
  id: 'url-decode',
  titleKey: 'utilityPipeline.adapter.urlDecode.title',
  descriptionKey: 'utilityPipeline.adapter.urlDecode.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [],
  defaultOptions: () => ({}),
  parseOptions: parseEmptyOptions,
  run: async (input) => {
    if (input.length === 0) return { ok: true, value: '' };
    const decoded = decodeUrlComponentSafe(input);
    if (decoded === null) {
      return {
        ok: false,
        reason: 'invalid-input',
        detail: 'malformed percent-encoding',
      };
    }
    return { ok: true, value: decoded };
  },
};
