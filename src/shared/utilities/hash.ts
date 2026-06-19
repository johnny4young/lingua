/**
 * RL-099 Slice 4 — `hash` adapter.
 *
 * Hashes the input text with a chosen Web Crypto algorithm and returns
 * the lowercase hex digest. Pure shared reimplementation: the renderer's
 * `computeHash` (developerUtilities.ts) carries HMAC + file modes the
 * pipeline does not need, and the shared layer cannot import the
 * renderer anyway — so this wraps `crypto.subtle.digest` directly
 * (available in the browser, the pipeline engine's main-thread context,
 * and Node >= 18, so vitest/jsdom).
 */

import type { UtilityAdapter, UtilityOptionField } from './types';

/**
 * Web Crypto digest algorithms surfaced as the `hash` adapter's
 * `algorithm` option. SHA-256 is the default. Source of truth for the
 * `parseOptions` guard + the options-form select.
 */
export const HASH_ADAPTER_ALGORITHMS = [
  'SHA-256',
  'SHA-1',
  'SHA-384',
  'SHA-512',
] as const;
export type HashAdapterAlgorithm = (typeof HASH_ADAPTER_ALGORITHMS)[number];

/** Structured options for the `hash` adapter. */
export interface HashAdapterOptions {
  readonly algorithm: HashAdapterAlgorithm;
}

const ALGORITHM_SET: ReadonlySet<string> = new Set(HASH_ADAPTER_ALGORITHMS);

const ALGORITHM_OPTION: UtilityOptionField = {
  key: 'algorithm',
  type: 'select',
  labelKey: 'utilityPipeline.adapter.hash.options.algorithm.label',
  defaultValue: 'SHA-256',
  options: [
    {
      value: 'SHA-256',
      labelKey: 'utilityPipeline.adapter.hash.options.algorithm.sha256',
    },
    {
      value: 'SHA-1',
      labelKey: 'utilityPipeline.adapter.hash.options.algorithm.sha1',
    },
    {
      value: 'SHA-384',
      labelKey: 'utilityPipeline.adapter.hash.options.algorithm.sha384',
    },
    {
      value: 'SHA-512',
      labelKey: 'utilityPipeline.adapter.hash.options.algorithm.sha512',
    },
  ],
};

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

export const hashAdapter: UtilityAdapter<HashAdapterOptions> = {
  id: 'hash',
  titleKey: 'utilityPipeline.adapter.hash.title',
  descriptionKey: 'utilityPipeline.adapter.hash.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [ALGORITHM_OPTION],
  defaultOptions: () => ({ algorithm: 'SHA-256' }),
  parseOptions: (raw) => {
    if (raw === undefined || raw === null) return { algorithm: 'SHA-256' };
    if (typeof raw !== 'object' || Array.isArray(raw)) return null;
    const candidate = (raw as { algorithm?: unknown }).algorithm;
    if (candidate === undefined) return { algorithm: 'SHA-256' };
    if (typeof candidate !== 'string' || !ALGORITHM_SET.has(candidate)) {
      return null;
    }
    return { algorithm: candidate as HashAdapterAlgorithm };
  },
  run: async (input, options) => {
    try {
      const digest = await crypto.subtle.digest(
        options.algorithm,
        new TextEncoder().encode(input)
      );
      return { ok: true, value: toHex(digest) };
    } catch (err) {
      return {
        ok: false,
        reason: 'execution-error',
        detail: err instanceof Error ? err.message : 'hash failed',
      };
    }
  },
};
