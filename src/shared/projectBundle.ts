/**
 * RL-024 Slice 3 — runnable project zip bundles.
 *
 * Pure, isomorphic core for export/import of a multi-file project as a
 * single `.zip`. Runs in BOTH the renderer (web export + import preview)
 * and the Electron main process (authoritative desktop import write), so
 * it must stay free of `node:*` imports and of `window`/DOM globals —
 * only `fflate` (isomorphic) + plain string path math.
 *
 * Security model (the whole reason this module is shared + heavily
 * guarded):
 *   - `validateBundleEntryPath` is the single chokepoint every entry
 *     path passes through on BOTH pack and unpack. It rejects absolute
 *     paths, `..` traversal, Windows drive letters, backslashes, and
 *     leading slashes — the classic zip-slip vectors. Main re-validates
 *     on extract (never trusts a renderer-supplied bundle), and the
 *     write strategy only ever writes REGULAR files at a validated
 *     relative join under the chosen root — it never creates symlinks,
 *     so a symlink entry decodes to an inert regular file that cannot
 *     escape the root (the high-level zip API does not surface unix mode
 *     bits, so this write-strategy neutralization is the symlink
 *     defense rather than mode-bit sniffing — fold D).
 *   - Caps bound memory + disk: the `unpackBundle` preflight rejects
 *     entries by their DECLARED `originalSize` BEFORE fflate decompresses
 *     them (`MAX_UNCOMPRESSED_BYTES` running total — fold A zip-bomb
 *     guard; `MAX_BUNDLE_FILES` count). That preflight trusts the zip
 *     header's size; a header that lies about `originalSize` is bounded
 *     by the `MAX_BUNDLE_BYTES` compressed-input cap (the hard memory
 *     ceiling — a 50 MiB DEFLATE stream can only inflate so far) and is
 *     caught post-decode by the `byteLength` re-check before any write.
 *     A streaming-`Unzip` rewrite (cap mid-decompression) is the deferred
 *     follow-up if that ceiling ever proves too loose.
 *
 * Binary-safe: entries are carried as `Uint8Array`, so images / fixtures
 * round-trip byte-for-byte when the caller chooses to include them.
 */

import { strToU8, unzipSync, zipSync, type UnzipFileInfo } from 'fflate';

/** Manifest schema version. Bumped only on a breaking manifest change. */
export const PROJECT_BUNDLE_VERSION = 1 as const;

/**
 * Reserved manifest filename written at the bundle root (fold B). On
 * import it is parsed for `entryFile` / `languageHint` and then excluded
 * from the extracted file set so it never lands on disk as project copy.
 */
export const PROJECT_BUNDLE_MANIFEST_NAME = 'lingua-bundle.json';

/** Max number of file entries a bundle may carry (export + import). */
export const MAX_BUNDLE_FILES = 5_000;

/** Max compressed bundle size accepted on import (the `.zip` bytes). */
export const MAX_BUNDLE_BYTES = 50 * 1024 * 1024; // 50 MiB

/**
 * Max TOTAL uncompressed size summed across every entry (fold A — the
 * zip-bomb guard). Tripped during `unpackBundle` BEFORE anything is
 * handed to a writer, so a tiny highly-compressed archive can never
 * exhaust memory or disk.
 */
export const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MiB

/** Max uncompressed size for a single entry. */
export const MAX_BUNDLE_ENTRY_BYTES = 16 * 1024 * 1024; // 16 MiB

/**
 * Closed enum of every reason a bundle (or a single entry) is rejected.
 * Mirrored in `update-server/src/telemetry.ts` and surfaced as the
 * `project.bundle_rejected { reason }` telemetry value, so the set is
 * load-bearing for the parity test — keep it sorted + in sync.
 */
export const BUNDLE_REJECT_REASONS = [
  'empty',
  'entry-too-large',
  'malformed-zip',
  'no-files',
  'path-traversal',
  'too-large',
  'too-many-files',
  'zip-bomb',
] as const;

export type BundleRejectReason = (typeof BUNDLE_REJECT_REASONS)[number];

/**
 * The `lingua-bundle.json` manifest (fold B). `createdAt` is supplied by
 * the caller (the IPC handler stamps `new Date().toISOString()`) so this
 * module stays deterministic + pure for unit tests. `entryFile` +
 * `languageHint` let a re-import restore the active tab + language
 * instead of dropping loose files (the "re-imported without manual
 * repair" acceptance criterion).
 */
export interface ProjectBundleManifestV1 {
  readonly version: typeof PROJECT_BUNDLE_VERSION;
  /** ISO-8601 timestamp, caller-stamped. */
  readonly createdAt: string;
  /** Project-relative path to reopen as the active tab, if known. */
  readonly entryFile?: string;
  /** Language-pack id hint for the entry file, if known. */
  readonly languageHint?: string;
  /** Number of project files (excludes the manifest itself). */
  readonly fileCount: number;
}

/** A single bundle entry: a POSIX-relative path + its raw bytes. */
export interface ProjectBundleFile {
  /** Validated POSIX relative path (no leading slash, no `..`). */
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** One rejected entry, surfaced in the import preview so the user sees what was skipped. */
export interface BundleEntryReject {
  readonly path: string;
  readonly reason: BundleRejectReason;
}

/** Caller-supplied manifest hints folded into the written manifest. */
export interface PackBundleManifestInput {
  readonly createdAt: string;
  readonly entryFile?: string;
  readonly languageHint?: string;
}

/**
 * Successful unpack: the validated file set, the parsed manifest (or
 * `null` when absent / unparseable — a bundle without our manifest still
 * imports as loose files), the entries we skipped, and the total
 * uncompressed bytes (for telemetry bucketing).
 */
export interface UnpackBundleOk {
  readonly ok: true;
  readonly manifest: ProjectBundleManifestV1 | null;
  readonly files: ProjectBundleFile[];
  readonly rejects: BundleEntryReject[];
  readonly totalBytes: number;
}

/** Whole-bundle rejection — nothing is safe to extract. */
export interface UnpackBundleErr {
  readonly ok: false;
  readonly reason: BundleRejectReason;
}

export type UnpackBundleResult = UnpackBundleOk | UnpackBundleErr;

/**
 * Cap overrides, defaulting to the module constants. Production callers
 * pass nothing; tests pass tiny caps to exercise the zip-bomb / count /
 * size guards without allocating hundreds of MiB. Overrides can only
 * make the limits SMALLER in practice — they never widen the real
 * production ceiling because production never passes them.
 */
export interface BundleCapOverrides {
  readonly maxBundleBytes?: number;
  readonly maxUncompressedBytes?: number;
  readonly maxFiles?: number;
  readonly maxEntryBytes?: number;
}

/**
 * Validate + normalize a single archive entry path. Returns the cleaned
 * POSIX relative path, or `null` when the path is unsafe. This is the
 * sole zip-slip chokepoint — both pack and unpack route through it.
 *
 * Rejects: empty, absolute (`/foo`, `C:\foo`, `\\unc`), any `..`
 * segment, backslashes (Windows separators that a POSIX `split('/')`
 * would miss), and `.`-only / trailing-slash directory markers.
 */
export function validateBundleEntryPath(rawPath: string): string | null {
  if (typeof rawPath !== 'string' || rawPath.length === 0) return null;
  // Reject backslashes outright rather than converting them: a path like
  // `a\..\..\b` is a Windows traversal that a POSIX-only normalizer would
  // wave through. Bundles we write only ever use `/`.
  if (rawPath.includes('\\')) return null;
  if (rawPath.includes('\0')) return null;
  // Drive-letter / UNC absolute forms.
  if (/^[a-zA-Z]:/.test(rawPath)) return null;
  // Leading slash = absolute POSIX.
  if (rawPath.startsWith('/')) return null;

  const segments = rawPath.split('/');
  const clean: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0) continue; // collapse `//` and trailing `/`
    if (segment === '.') continue;
    if (segment === '..') return null; // traversal — hard reject
    clean.push(segment);
  }
  if (clean.length === 0) return null; // pure directory / `.` entry
  return clean.join('/');
}

/**
 * Pack a set of files into a `.zip` byte array with a
 * `lingua-bundle.json` manifest at the root. Throws `RangeError` when
 * the file count exceeds `MAX_BUNDLE_FILES` or any entry path is unsafe
 * — callers (the export IPC) treat a throw as a hard failure, not a
 * partial bundle.
 */
export function packBundle(
  files: ProjectBundleFile[],
  manifestInput: PackBundleManifestInput
): Uint8Array {
  if (files.length > MAX_BUNDLE_FILES) {
    throw new RangeError(
      `Bundle exceeds ${MAX_BUNDLE_FILES} files (${files.length})`
    );
  }
  const zipInput: Record<string, Uint8Array> = {};
  for (const file of files) {
    const safe = validateBundleEntryPath(file.path);
    if (safe === null) {
      throw new RangeError(`Unsafe bundle entry path: ${file.path}`);
    }
    if (safe === PROJECT_BUNDLE_MANIFEST_NAME) continue; // never let project copy shadow the manifest
    zipInput[safe] = file.bytes;
  }
  const manifest: ProjectBundleManifestV1 = {
    version: PROJECT_BUNDLE_VERSION,
    createdAt: manifestInput.createdAt,
    ...(manifestInput.entryFile ? { entryFile: manifestInput.entryFile } : {}),
    ...(manifestInput.languageHint
      ? { languageHint: manifestInput.languageHint }
      : {}),
    fileCount: Object.keys(zipInput).length,
  };
  zipInput[PROJECT_BUNDLE_MANIFEST_NAME] = strToU8(
    JSON.stringify(manifest, null, 2)
  );
  return zipSync(zipInput, { level: 6 });
}

/**
 * Decode + validate a `.zip` byte array into a safe file set. Never
 * throws: every failure maps to a closed `BundleRejectReason`, either as
 * a whole-bundle `{ ok: false, reason }` or a per-entry `rejects[]` row.
 * Caps (size, count, zip-bomb) are enforced here, BEFORE any byte
 * reaches a writer.
 */
export function unpackBundle(
  zipBytes: Uint8Array,
  opts: BundleCapOverrides = {}
): UnpackBundleResult {
  const maxBundleBytes = opts.maxBundleBytes ?? MAX_BUNDLE_BYTES;
  const maxUncompressedBytes = opts.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES;
  const maxFiles = opts.maxFiles ?? MAX_BUNDLE_FILES;
  const maxEntryBytes = opts.maxEntryBytes ?? MAX_BUNDLE_ENTRY_BYTES;

  if (!zipBytes || zipBytes.byteLength === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (zipBytes.byteLength > maxBundleBytes) {
    return { ok: false, reason: 'too-large' };
  }

  let decoded: Record<string, Uint8Array>;
  let preflightReason: BundleRejectReason | null = null;
  const preflightRejects: BundleEntryReject[] = [];
  let preflightFileCount = 0;
  let preflightBytes = 0;
  try {
    decoded = unzipSync(zipBytes, {
      filter: (entry) => {
        if (preflightReason) return false;
        const decision = preflightBundleEntry(entry, {
          maxEntryBytes,
          maxFiles,
          maxUncompressedBytes,
          currentFileCount: preflightFileCount,
          currentBytes: preflightBytes,
        });
        if (decision.kind === 'skip') {
          if (decision.reject) preflightRejects.push(decision.reject);
          return false;
        }
        if (decision.kind === 'fatal') {
          preflightReason = decision.reason;
          return false;
        }
        preflightBytes += entry.originalSize;
        if (decision.countsAsFile) preflightFileCount += 1;
        return true;
      },
    });
  } catch {
    return { ok: false, reason: 'malformed-zip' };
  }
  if (preflightReason) {
    return { ok: false, reason: preflightReason };
  }

  const files: ProjectBundleFile[] = [];
  const rejects: BundleEntryReject[] = [...preflightRejects];
  let manifest: ProjectBundleManifestV1 | null = null;
  let totalBytes = 0;

  for (const [rawPath, bytes] of Object.entries(decoded)) {
    // Directory markers (`foo/`) decode to zero-byte entries; skip them.
    if (rawPath.endsWith('/')) continue;

    if (rawPath === PROJECT_BUNDLE_MANIFEST_NAME) {
      manifest = parseManifest(bytes);
      continue;
    }

    const safe = validateBundleEntryPath(rawPath);
    if (safe === null) {
      rejects.push({ path: rawPath, reason: 'path-traversal' });
      continue;
    }
    if (bytes.byteLength > maxEntryBytes) {
      rejects.push({ path: safe, reason: 'entry-too-large' });
      continue;
    }
    totalBytes += bytes.byteLength;
    // Fold A — zip-bomb guard. Trip the moment the running total crosses
    // the cap so a malicious archive can't be fully buffered first.
    if (totalBytes > maxUncompressedBytes) {
      return { ok: false, reason: 'zip-bomb' };
    }
    if (files.length >= maxFiles) {
      return { ok: false, reason: 'too-many-files' };
    }
    files.push({ path: safe, bytes });
  }

  if (files.length === 0) {
    return { ok: false, reason: 'no-files' };
  }
  return { ok: true, manifest, files, rejects, totalBytes };
}

/**
 * Parse the manifest bytes into a `ProjectBundleManifestV1`, or `null`
 * when malformed / wrong-version. A missing or bad manifest is NOT fatal
 * — the bundle still imports as loose files; we just lose the entry-file
 * + language hints.
 */
function parseManifest(bytes: Uint8Array): ProjectBundleManifestV1 | null {
  let raw: unknown;
  try {
    raw = JSON.parse(strU8ToString(bytes));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== PROJECT_BUNDLE_VERSION) return null;
  if (typeof record.createdAt !== 'string') return null;
  const fileCount =
    typeof record.fileCount === 'number' && Number.isFinite(record.fileCount)
      ? record.fileCount
      : 0;
  return {
    version: PROJECT_BUNDLE_VERSION,
    createdAt: record.createdAt,
    ...(typeof record.entryFile === 'string'
      ? { entryFile: record.entryFile }
      : {}),
    ...(typeof record.languageHint === 'string'
      ? { languageHint: record.languageHint }
      : {}),
    fileCount,
  };
}

type PreflightDecision =
  | { readonly kind: 'include'; readonly countsAsFile: boolean }
  | { readonly kind: 'skip'; readonly reject?: BundleEntryReject }
  | { readonly kind: 'fatal'; readonly reason: BundleRejectReason };

function preflightBundleEntry(
  entry: UnzipFileInfo,
  caps: {
    readonly maxEntryBytes: number;
    readonly maxFiles: number;
    readonly maxUncompressedBytes: number;
    readonly currentFileCount: number;
    readonly currentBytes: number;
  }
): PreflightDecision {
  // Directory markers do not carry project data and should never be inflated.
  if (entry.name.endsWith('/')) return { kind: 'skip' };

  const safe =
    entry.name === PROJECT_BUNDLE_MANIFEST_NAME
      ? PROJECT_BUNDLE_MANIFEST_NAME
      : validateBundleEntryPath(entry.name);
  if (safe === null) {
    return {
      kind: 'skip',
      reject: { path: entry.name, reason: 'path-traversal' },
    };
  }

  if (entry.originalSize > caps.maxEntryBytes) {
    return {
      kind: 'skip',
      reject: {
        path: safe,
        reason: 'entry-too-large',
      },
    };
  }

  const projectedBytes = caps.currentBytes + entry.originalSize;
  if (projectedBytes > caps.maxUncompressedBytes) {
    return { kind: 'fatal', reason: 'zip-bomb' };
  }

  if (entry.name === PROJECT_BUNDLE_MANIFEST_NAME) {
    return { kind: 'include', countsAsFile: false };
  }

  if (caps.currentFileCount >= caps.maxFiles) {
    return { kind: 'fatal', reason: 'too-many-files' };
  }

  return { kind: 'include', countsAsFile: true };
}

/**
 * Decode UTF-8 bytes to a string without depending on the DOM
 * `TextDecoder` typings vs. node's — `TextDecoder` is global in both
 * modern Node (>=11) and every browser, so a direct call stays
 * isomorphic.
 */
function strU8ToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
