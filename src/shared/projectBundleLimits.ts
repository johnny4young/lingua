/** Shared import/export budgets for project archives. */

/** Max number of project file entries a bundle may carry. */
export const MAX_BUNDLE_FILES = 5_000;

/** Max compressed bundle size accepted on import and produced on export. */
export const MAX_BUNDLE_BYTES = 50 * 1024 * 1024; // 50 MiB

/** Max total bytes after inflation, including the internal manifest. */
export const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MiB

/** Max uncompressed size for a single archive entry. */
export const MAX_BUNDLE_ENTRY_BYTES = 16 * 1024 * 1024; // 16 MiB

export const BUNDLE_EXPORT_REJECT_REASONS = [
  'entry-too-large',
  'too-large',
  'too-many-files',
] as const;

export type BundleExportRejectReason =
  (typeof BUNDLE_EXPORT_REJECT_REASONS)[number];

/** Typed limit failure shared by web and desktop export choreography. */
export class ProjectBundleExportError extends RangeError {
  readonly reason: BundleExportRejectReason;

  constructor(reason: BundleExportRejectReason, message: string) {
    super(message);
    this.name = 'ProjectBundleExportError';
    this.reason = reason;
  }
}

/** Test overrides can narrow, but never widen, production limits. */
export interface BundleCapOverrides {
  readonly maxBundleBytes?: number;
  readonly maxUncompressedBytes?: number;
  readonly maxFiles?: number;
  readonly maxEntryBytes?: number;
}

export interface ResolvedBundleCaps {
  readonly maxBundleBytes: number;
  readonly maxUncompressedBytes: number;
  readonly maxFiles: number;
  readonly maxEntryBytes: number;
}

function clampCap(value: number | undefined, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return maximum;
  return Math.max(0, Math.min(Math.floor(value), maximum));
}

export function resolveBundleCaps(
  opts: BundleCapOverrides
): ResolvedBundleCaps {
  return {
    maxBundleBytes: clampCap(opts.maxBundleBytes, MAX_BUNDLE_BYTES),
    maxUncompressedBytes: clampCap(
      opts.maxUncompressedBytes,
      MAX_UNCOMPRESSED_BYTES
    ),
    maxFiles: clampCap(opts.maxFiles, MAX_BUNDLE_FILES),
    maxEntryBytes: clampCap(opts.maxEntryBytes, MAX_BUNDLE_ENTRY_BYTES),
  };
}

/**
 * Check one prospective project file against the export budget. The caller
 * passes the count and bytes already accepted; the reason is stable across
 * renderer and main-process collectors.
 */
export function projectBundleExportLimit(
  currentFileCount: number,
  currentBytes: number,
  nextEntryBytes: number,
  opts: BundleCapOverrides = {}
): BundleExportRejectReason | null {
  const caps = resolveBundleCaps(opts);
  if (currentFileCount >= caps.maxFiles) return 'too-many-files';
  if (nextEntryBytes > caps.maxEntryBytes) return 'entry-too-large';
  if (currentBytes + nextEntryBytes > caps.maxUncompressedBytes) {
    return 'too-large';
  }
  return null;
}
