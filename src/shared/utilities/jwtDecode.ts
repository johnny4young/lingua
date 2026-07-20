/**
 * implementation — `jwt-decode` adapter.
 *
 * Decodes a JWT into pretty-printed JSON of its header + payload.
 * DECODE ONLY — it does NOT verify the signature (the copy says so). A
 * pure shared reimplementation of the decode half of the renderer's
 * `decodeJwt` (src/renderer/utils/jwt.ts), which the shared layer cannot
 * import. Malformed input never throws; it resolves to `invalid-input`.
 */

import type { UtilityAdapter } from './types';

/** No options — decode is deterministic. */
export type JwtDecodeOptions = Record<string, never>;

function parseEmptyOptions(raw: unknown): JwtDecodeOptions | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {};
}

/** Base64URL → JSON object. Throws on malformed input (caller catches). */
function decodeSegment(segment: string): Record<string, unknown> {
  // Restore standard base64 from the URL-safe alphabet + padding.
  const base64 = segment
    .replace(/-/gu, '+')
    .replace(/_/gu, '/')
    .padEnd(Math.ceil(segment.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(json) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('segment is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export const jwtDecodeAdapter: UtilityAdapter<JwtDecodeOptions> = {
  id: 'jwt-decode',
  titleKey: 'utilityPipeline.adapter.jwtDecode.title',
  descriptionKey: 'utilityPipeline.adapter.jwtDecode.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [],
  defaultOptions: () => ({}),
  parseOptions: parseEmptyOptions,
  run: async (input) => {
    const trimmed = input.trim();
    const segments = trimmed.split('.');
    if (segments.length < 2 || !segments[0] || !segments[1]) {
      return {
        ok: false,
        reason: 'invalid-input',
        detail: 'expected a JWT with header and payload segments',
      };
    }
    try {
      const header = decodeSegment(segments[0]);
      const payload = decodeSegment(segments[1]);
      return { ok: true, value: JSON.stringify({ header, payload }, null, 2) };
    } catch (err) {
      return {
        ok: false,
        reason: 'invalid-input',
        detail: err instanceof Error ? err.message : 'invalid JWT',
      };
    }
  },
};
