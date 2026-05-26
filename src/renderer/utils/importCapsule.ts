/**
 * RL-094 Slice 2 — Capsule import.
 *
 * Inverse of `exportCapsule.ts`. Decodes a JSON string into a
 * `RunCapsuleV1` and returns a discriminated reject reason when the
 * input cannot be parsed.
 *
 * The validator is `parseRunCapsule` from `src/shared/runCapsule.ts` —
 * we never roll a second schema check in the renderer. That keeps the
 * "schema lives in shared, capsules embed by version 1 only"
 * invariant honest. This module just maps `parseRunCapsule`'s closed
 * enum of reject reasons onto a smaller renderer-facing enum that the
 * overlay UI consumes directly for the rejection copy + telemetry
 * status bucket.
 *
 * Closed-enum reject reasons (mapped to i18n keys 1:1):
 *
 *   - `empty`            — input string was empty (trimmed).
 *   - `malformed-json`   — JSON.parse failed.
 *   - `wrong-version`    — top-level `version` !== 1.
 *   - `oversized`        — UTF-8 byte length > MAX_CAPSULE_BYTES (4 MiB).
 *   - `invalid-shape`    — load-bearing field missing or wrong type.
 *
 * `tryDecodeCapsuleJson` returns the size bucket on both ok + rejected
 * paths so the caller can stamp telemetry without leaking content;
 * no separate sizing helper is exported (the `bucketCapsuleSize` from
 * `src/shared/runCapsule` is the single source of truth).
 */

import {
  bucketCapsuleSize,
  parseRunCapsule,
  utf8ByteLength,
  type CapsuleSizeBucket,
  type RunCapsuleV1,
} from '../../shared/runCapsule';

export type CapsuleImportRejectReason =
  | 'empty'
  | 'malformed-json'
  | 'wrong-version'
  | 'oversized'
  | 'invalid-shape';

export type CapsuleImportDecodeResult =
  | { ok: true; capsule: RunCapsuleV1; sizeBucket: CapsuleSizeBucket; byteLength: number }
  | {
      ok: false;
      reason: CapsuleImportRejectReason;
      sizeBucket: CapsuleSizeBucket;
      byteLength: number;
      detail?: string;
    };

/**
 * Pure decode helper. Trims leading/trailing whitespace before
 * parsing so a paste with newlines around the JSON still decodes.
 * Returns a discriminated union including the byte-length size bucket
 * so the caller can stamp telemetry regardless of outcome.
 */
export function tryDecodeCapsuleJson(source: string): CapsuleImportDecodeResult {
  const trimmed = typeof source === 'string' ? source.trim() : '';
  const byteLength = utf8ByteLength(trimmed);
  const sizeBucket = bucketCapsuleSize(byteLength);
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty', sizeBucket, byteLength };
  }
  const result = parseRunCapsule(trimmed);
  if (result.ok) {
    return { ok: true, capsule: result.value, sizeBucket, byteLength };
  }
  const reason = mapParseReason(result.reason);
  return {
    ok: false,
    reason,
    sizeBucket,
    byteLength,
    ...(result.detail ? { detail: result.detail } : {}),
  };
}

function mapParseReason(
  reason: ReturnType<typeof parseRunCapsule> extends { ok: true }
    ? never
    : Extract<ReturnType<typeof parseRunCapsule>, { ok: false }>['reason']
): CapsuleImportRejectReason {
  switch (reason) {
    case 'invalid-json':
      return 'malformed-json';
    case 'unsupported-version':
      return 'wrong-version';
    case 'oversized':
      return 'oversized';
    case 'missing-required-field':
    case 'invalid-field-type':
      return 'invalid-shape';
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

