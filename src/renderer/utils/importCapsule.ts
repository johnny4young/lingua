/**
 * implementation — Capsule import.
 *
 * Inverse of `exportCapsule.ts`. Decodes a JSON string into a
 * `RunCapsuleV1` and returns a discriminated reject reason when the
 * input cannot be parsed.
 *
 * The validator is `parseRunCapsule` from `src/shared/runCapsule.ts` —
 * we never roll a second schema check in the renderer. That keeps the
 * "schema lives in shared, version handling lives with the schema"
 * invariant honest. This module just maps `parseRunCapsule`'s closed
 * enum of reject reasons onto a smaller renderer-facing enum that the
 * overlay UI consumes directly for the rejection copy + telemetry
 * status bucket.
 *
 * Closed-enum reject reasons (mapped to i18n keys 1:1):
 *
 *   - `empty`            — input string was empty (trimmed).
 *   - `malformed-json`   — JSON.parse failed.
 *   - `app-too-old`      — capsule written by a NEWER Lingua. The file is
 *                          fine; this build is behind, so the copy says to
 *                          update the app.
 *   - `wrong-version`    — no usable schema version: either older than
 *                          anything this build can migrate up, or not an
 *                          integer >= 1 at all.
 *   - `oversized`        — UTF-8 byte length > MAX_CAPSULE_BYTES (4 MiB).
 *   - `invalid-shape`    — load-bearing field missing or wrong type.
 *
 * The `app-too-old` / `wrong-version` split is the reason this enum grew:
 * collapsing them tells a user with a perfectly good capsule that their
 * file is broken.
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
import {
  isCapsuleWorkspaceJson,
  MAX_CAPSULE_WORKSPACE_BYTES,
  parseCapsuleWorkspace,
  type CapsuleWorkspaceRejectReason,
  type CapsuleWorkspaceV1,
} from '../../shared/capsuleWorkspace';

export type CapsuleImportRejectReason =
  | 'empty'
  | 'malformed-json'
  | 'wrong-version'
  /** Capsule from a newer Lingua; the fix is updating the app, not the file. */
  | 'app-too-old'
  | 'oversized'
  | 'invalid-shape';

export type CapsuleImportDecodeResult =
  | {
      ok: true;
      capsule: RunCapsuleV1;
      workspace?: CapsuleWorkspaceV1;
      sizeBucket: CapsuleSizeBucket;
      byteLength: number;
    }
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
  if (byteLength > MAX_CAPSULE_WORKSPACE_BYTES) {
    return { ok: false, reason: 'oversized', sizeBucket, byteLength };
  }
  if (isCapsuleWorkspaceJson(trimmed)) {
    const workspace = parseCapsuleWorkspace(trimmed);
    if (workspace.ok) {
      return {
        ok: true,
        capsule: workspace.value.capsule,
        workspace: workspace.value,
        sizeBucket,
        byteLength,
      };
    }
    return {
      ok: false,
      reason: mapWorkspaceReason(workspace.reason, workspace.detail),
      sizeBucket,
      byteLength,
      ...(workspace.detail ? { detail: workspace.detail } : {}),
    };
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

function mapWorkspaceReason(
  reason: CapsuleWorkspaceRejectReason,
  detail?: string
): CapsuleImportRejectReason {
  switch (reason) {
    case 'invalid-json':
      return 'malformed-json';
    case 'unsupported-version':
      return workspaceVersionFromDetail(detail) > 1 ? 'app-too-old' : 'wrong-version';
    case 'too-many-files':
    case 'file-too-large':
    case 'files-too-large':
    case 'artifact-too-large':
      return 'oversized';
    case 'invalid-shape':
    case 'invalid-capsule':
    case 'invalid-path':
    case 'duplicate-path':
      return 'invalid-shape';
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

function workspaceVersionFromDetail(detail?: string): number {
  const match = /^version=(\d+)$/u.exec(detail ?? '');
  return match ? Number(match[1]) : Number.NaN;
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
    case 'capsule-from-newer-app':
      return 'app-too-old';
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
