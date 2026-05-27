/**
 * RL-099 Slice 1 — `base64-encode` + `base64-decode` adapters.
 *
 * Pure UTF-8 encoder/decoder mirroring the renderer's
 * `developerUtilities.ts` implementations so the panel and the
 * pipeline engine share one source of truth. `atob` / `btoa` are
 * available in both browser and Node 18+; no polyfill needed.
 */

import type { UtilityAdapter } from './types';

/** No options — encode is deterministic. Shape kept stable for adapter contract. */
export type Base64Options = Record<string, never>;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function parseEmptyOptions(raw: unknown): Base64Options | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {};
}

export const base64EncodeAdapter: UtilityAdapter<Base64Options> = {
  id: 'base64-encode',
  titleKey: 'utilityPipeline.adapter.base64Encode.title',
  descriptionKey: 'utilityPipeline.adapter.base64Encode.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [],
  defaultOptions: () => ({}),
  parseOptions: parseEmptyOptions,
  run: async (input) => {
    try {
      const value = bytesToBase64(new TextEncoder().encode(input));
      return { ok: true, value };
    } catch (err) {
      return {
        ok: false,
        reason: 'execution-error',
        detail: err instanceof Error ? err.message : 'encode failed',
      };
    }
  },
};

export const base64DecodeAdapter: UtilityAdapter<Base64Options> = {
  id: 'base64-decode',
  titleKey: 'utilityPipeline.adapter.base64Decode.title',
  descriptionKey: 'utilityPipeline.adapter.base64Decode.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [],
  defaultOptions: () => ({}),
  parseOptions: parseEmptyOptions,
  run: async (input) => {
    if (input.trim().length === 0) {
      return { ok: true, value: '' };
    }
    try {
      const sanitized = input.replace(/\s+/gu, '');
      const bytes = base64ToBytes(sanitized);
      const value = new TextDecoder().decode(bytes);
      return { ok: true, value };
    } catch (err) {
      return {
        ok: false,
        reason: 'invalid-input',
        detail: err instanceof Error ? err.message : 'invalid base64',
      };
    }
  },
};
