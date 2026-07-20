// SPDX-License-Identifier: MIT
/**
 * implementation — project zip bundle telemetry helpers.
 *
 * Three closed-enum events fire here and only here:
 *   - `project.bundle_exported { status, fileCountBucket }`
 *   - `project.bundle_imported { status, fileCountBucket }`
 *   - `project.bundle_rejected { reason }` (structural archive failures)
 *
 * NO file paths, NO file names, NO bytes ever reach the wire — only the
 * closed status / reason enums and a coarse file-count bucket. The
 * payload shapes are validated by the renderer redactor AND the
 * update-server worker, with a parity test guarding the reject-reason
 * enum against `BUNDLE_REJECT_REASONS`.
 */

import { trackEvent } from '../utils/telemetry';

/**
 * Bucket a raw file count into the closed `DEPENDENCY_COUNT_BUCKETS_SET`
 * the redactor accepts (`'0' | '1' | '2-5' | '6-10' | '>10'`), reused
 * here so we never add a parallel count enum.
 */
export function bundleFileCountBucket(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 10) return '6-10';
  return '>10';
}

export type BundleExportStatus = 'cancelled' | 'empty' | 'exported' | 'failed';
export type BundleImportStatus =
  | 'cancelled'
  | 'imported'
  | 'non-empty-dir'
  | 'rejected';

export function trackBundleExported(
  status: BundleExportStatus,
  fileCount: number
): void {
  void trackEvent('project.bundle_exported', {
    status,
    fileCountBucket: bundleFileCountBucket(fileCount),
  });
}

export function trackBundleImported(
  status: BundleImportStatus,
  fileCount: number
): void {
  void trackEvent('project.bundle_imported', {
    status,
    fileCountBucket: bundleFileCountBucket(fileCount),
  });
}

export function trackBundleRejected(reason: string): void {
  void trackEvent('project.bundle_rejected', { reason });
}
