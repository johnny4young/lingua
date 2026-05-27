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
import type { ImporterId } from '../../shared/importers/types';
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
