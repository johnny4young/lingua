/**
 * RL-100 Slice 1 fold E — Import telemetry helper.
 *
 * Single closed-enum event: `import.applied { importerId, status, sizeBucket }`.
 *
 *   - `importerId` ∈ `IMPORTER_IDS_SET` from `src/shared/telemetry.ts`
 *     (Slice 1: `'curl-http'` only; open for Slice 2 `'ipynb-notebook'`
 *     and Slice 3 `'postman-collection'` / `'bruno-collection'`).
 *   - `status` ∈ `IMPORT_STATUSES_SET` (`'ok' | 'rejected' | 'cancelled'`).
 *   - `sizeBucket` ∈ `CAPSULE_SIZE_BUCKETS` reused from RL-094.
 *
 * NO URL, NO header values, NO body content reach the wire — only
 * the bucketed source size + the closed importer + status enums.
 * Mirrored on `update-server/src/telemetry.ts` with parity test.
 */

import type { CapsuleSizeBucket } from '../../shared/runCapsule';
import {
  bucketDependencyCount,
  type DependencyCountBucket,
} from '../../shared/dependencies/types';
import type {
  ImporterId,
  ImporterLossyWarning,
  NotebookWarningKind,
} from '../../shared/importers/types';
import { mapWarningToTelemetryKind } from '../../shared/importers/ipynbImporter';
import { trackEvent } from '../utils/telemetry';

export type ImportTelemetryStatus = 'ok' | 'rejected' | 'cancelled';

export interface ImportAppliedPayload {
  importerId: ImporterId;
  status: ImportTelemetryStatus;
  sizeBucket: CapsuleSizeBucket;
}

export function trackImportApplied(payload: ImportAppliedPayload): void {
  void trackEvent('import.applied', {
    importerId: payload.importerId,
    status: payload.status,
    sizeBucket: payload.sizeBucket,
  });
}

/**
 * RL-100 Slice 2 fold E — closed-enum buckets for the notebook
 * warning count. Mirrors `DEPENDENCY_COUNT_BUCKETS_SET` precedent
 * used by other count-bucketed events (e.g. `http.request_executed`
 * `redactedHeadersBucket`).
 */
export type WarningKindCountBucket = '0' | '1' | '2-5' | '6-10' | '>10';

export function bucketWarningKindCount(count: number): WarningKindCountBucket {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 10) return '6-10';
  return '>10';
}

export interface NotebookWarningsSurfacedPayload {
  warningKindCount: WarningKindCountBucket;
  dominantKind: NotebookWarningKind;
}

export function trackNotebookWarningsSurfaced(
  payload: NotebookWarningsSurfacedPayload
): void {
  void trackEvent('import.notebook_warnings_surfaced', {
    warningKindCount: payload.warningKindCount,
    dominantKind: payload.dominantKind,
  });
}

/**
 * RL-100 Slice 2 fold E — derive `dominantKind` from the warning
 * codes array. Returns `null` when the array is empty (caller must
 * not fire the event in that case).
 */
export function deriveDominantNotebookWarning(
  warnings: ReadonlyArray<ImporterLossyWarning>
): NotebookWarningKind | null {
  if (warnings.length === 0) return null;
  const counts: Partial<Record<NotebookWarningKind, number>> = {};
  let topCount = 0;
  let topKind: NotebookWarningKind | null = null;
  for (const code of warnings) {
    const kind = mapWarningToTelemetryKind(code);
    if (kind === null) continue;
    const next = (counts[kind] ?? 0) + 1;
    counts[kind] = next;
    if (next > topCount) {
      topCount = next;
      topKind = kind;
    }
  }
  return topKind;
}

export function countDistinctNotebookWarningKinds(
  warnings: ReadonlyArray<ImporterLossyWarning>
): number {
  const kinds = new Set<NotebookWarningKind>();
  for (const code of warnings) {
    const kind = mapWarningToTelemetryKind(code);
    if (kind !== null) kinds.add(kind);
  }
  return kinds.size;
}

/**
 * RL-100 Slice 3.5 (Postman vars) fold B — `import.postman_variables_resolved`.
 *
 * Buckets the distinct collection-variable resolution result of a
 * Postman import into the shared `DEPENDENCY_COUNT_BUCKETS` enum (the
 * same bucketer the HTTP workspace's `resolvedVarsBucket` uses). The
 * caller fires this ONLY when the collection referenced at least one
 * `{{variable}}` (resolved OR unresolved); a variable-free import skips
 * the event entirely. NO variable names or values reach the wire.
 */
export interface PostmanVariablesResolvedPayload {
  resolvedBucket: DependencyCountBucket;
  unresolvedBucket: DependencyCountBucket;
}

export function trackPostmanVariablesResolved(
  payload: PostmanVariablesResolvedPayload
): void {
  void trackEvent('import.postman_variables_resolved', {
    resolvedBucket: payload.resolvedBucket,
    unresolvedBucket: payload.unresolvedBucket,
  });
}

/** Bucket a distinct variable count for the fold-B telemetry event. */
export function bucketImportVariableCount(count: number): DependencyCountBucket {
  return bucketDependencyCount(count);
}
