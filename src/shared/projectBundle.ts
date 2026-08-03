/**
 * implementation — runnable project zip bundles.
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
 *     defense rather than mode-bit sniffing — implementation note).
 *   - Caps bound memory + disk: `unpackBundle` rejects honest oversized
 *     headers before starting an entry, then streams compressed input in
 *     bounded chunks and counts the ACTUAL inflated bytes. A header that
 *     lies about `originalSize` therefore trips the same per-entry or total
 *     limit during inflation instead of allocating the entire archive first.
 *     Pack uses the same caps so Lingua never exports a bundle its importer
 *     would reject.
 *
 * Binary-safe: entries are carried as `Uint8Array`, so images / fixtures
 * round-trip byte-for-byte when the caller chooses to include them.
 */

import {
  strToU8,
  Unzip,
  UnzipInflate,
  UnzipPassThrough,
  zipSync,
  type UnzipFile,
} from 'fflate';
import {
  ProjectBundleExportError,
  projectBundleExportLimit,
  resolveBundleCaps,
  type BundleCapOverrides,
} from './projectBundleLimits';
export {
  BUNDLE_EXPORT_REJECT_REASONS,
  MAX_BUNDLE_ENTRY_BYTES,
  MAX_BUNDLE_FILES,
  ProjectBundleExportError,
  projectBundleExportLimit,
} from './projectBundleLimits';
export type {
  BundleCapOverrides,
  BundleExportRejectReason,
} from './projectBundleLimits';

/** Manifest schema version. Bumped only on a breaking manifest change. */
export const PROJECT_BUNDLE_VERSION = 1 as const;

/**
 * Reserved manifest filename written at the bundle root (implementation note). On
 * import it is parsed for `entryFile` / `languageHint` and then excluded
 * from the extracted file set so it never lands on disk as project copy.
 */
export const PROJECT_BUNDLE_MANIFEST_NAME = 'lingua-bundle.json';

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
 * The `lingua-bundle.json` manifest (implementation note). `createdAt` is supplied by
 * the caller (the IPC handler stamps `new Date().toISOString()`) so this
 * module stays deterministic + pure for unit tests. `entryFile` +
 * `languageHint` let a re-import restore the active tab + language
 * instead of dropping loose files (the "re-imported without manual
 * repair" acceptance criterion).
 */
interface ProjectBundleManifestV1 {
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
interface BundleEntryReject {
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
interface UnpackBundleOk {
  readonly ok: true;
  readonly manifest: ProjectBundleManifestV1 | null;
  readonly files: ProjectBundleFile[];
  readonly rejects: BundleEntryReject[];
  readonly totalBytes: number;
}

/** Whole-bundle rejection — nothing is safe to extract. */
interface UnpackBundleErr {
  readonly ok: false;
  readonly reason: BundleRejectReason;
}

export type UnpackBundleResult = UnpackBundleOk | UnpackBundleErr;

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
 * `lingua-bundle.json` manifest at the root. Unsafe paths throw a plain
 * `RangeError`; size/count failures throw `ProjectBundleExportError` with
 * a stable reason. Export is all-or-nothing — no silent file omission.
 */
export function packBundle(
  files: ProjectBundleFile[],
  manifestInput: PackBundleManifestInput,
  opts: BundleCapOverrides = {}
): Uint8Array {
  const caps = resolveBundleCaps(opts);
  const zipInput: Record<string, Uint8Array> = {};
  let fileCount = 0;
  let totalBytes = 0;
  for (const file of files) {
    const safe = validateBundleEntryPath(file.path);
    if (safe === null) {
      throw new RangeError(`Unsafe bundle entry path: ${file.path}`);
    }
    if (safe === PROJECT_BUNDLE_MANIFEST_NAME) {
      throw new RangeError(
        `Reserved bundle entry path cannot be exported: ${safe}`
      );
    }
    if (Object.hasOwn(zipInput, safe)) {
      throw new RangeError(`Duplicate bundle entry path: ${safe}`);
    }
    const reason = projectBundleExportLimit(
      fileCount,
      totalBytes,
      file.bytes.byteLength,
      caps
    );
    if (reason) {
      throw new ProjectBundleExportError(
        reason,
        `Bundle export rejected ${safe}: ${reason}`
      );
    }
    zipInput[safe] = file.bytes;
    fileCount += 1;
    totalBytes += file.bytes.byteLength;
  }
  const manifest: ProjectBundleManifestV1 = {
    version: PROJECT_BUNDLE_VERSION,
    createdAt: manifestInput.createdAt,
    ...(manifestInput.entryFile ? { entryFile: manifestInput.entryFile } : {}),
    ...(manifestInput.languageHint
      ? { languageHint: manifestInput.languageHint }
      : {}),
    fileCount,
  };
  const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
  if (totalBytes + manifestBytes.byteLength > caps.maxUncompressedBytes) {
    throw new ProjectBundleExportError(
      'too-large',
      'Bundle manifest exceeds the uncompressed export budget'
    );
  }
  zipInput[PROJECT_BUNDLE_MANIFEST_NAME] = manifestBytes;
  const zipBytes = zipSync(zipInput, { level: 6 });
  if (zipBytes.byteLength > caps.maxBundleBytes) {
    throw new ProjectBundleExportError(
      'too-large',
      'Compressed bundle exceeds the import budget'
    );
  }
  return zipBytes;
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
  const caps = resolveBundleCaps(opts);

  if (!zipBytes || zipBytes.byteLength === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (zipBytes.byteLength > caps.maxBundleBytes) {
    return { ok: false, reason: 'too-large' };
  }
  if (!hasZipEndRecord(zipBytes)) {
    return { ok: false, reason: 'malformed-zip' };
  }

  const files: ProjectBundleFile[] = [];
  const rejects: BundleEntryReject[] = [];
  let manifest: ProjectBundleManifestV1 | null = null;
  let totalBytes = 0;
  let totalInflatedBytes = 0;
  let declaredInflatedBytes = 0;
  let archiveFileCount = 0;
  let activeEntries = 0;
  let fatalReason: BundleRejectReason | null = null;
  const seenPaths = new Set<string>();

  const rejectEntry = (
    file: UnzipFile,
    path: string,
    reason: BundleRejectReason
  ): void => {
    rejects.push({ path, reason });
    file.terminate();
  };

  const unzip = new Unzip((file) => {
    if (fatalReason) {
      file.terminate();
      return;
    }
    if (file.name.endsWith('/')) {
      file.terminate();
      return;
    }

    const isManifest = file.name === PROJECT_BUNDLE_MANIFEST_NAME;
    if (!isManifest) {
      archiveFileCount += 1;
      if (archiveFileCount > caps.maxFiles) {
        fatalReason = 'too-many-files';
        file.terminate();
        return;
      }
    }

    const safe = isManifest
      ? PROJECT_BUNDLE_MANIFEST_NAME
      : validateBundleEntryPath(file.name);
    if (safe === null) {
      rejectEntry(file, file.name, 'path-traversal');
      return;
    }
    if (seenPaths.has(safe)) {
      fatalReason = 'malformed-zip';
      file.terminate();
      return;
    }
    seenPaths.add(safe);

    if (
      typeof file.originalSize === 'number' &&
      file.originalSize > caps.maxEntryBytes
    ) {
      rejectEntry(file, safe, 'entry-too-large');
      return;
    }
    if (typeof file.originalSize === 'number') {
      declaredInflatedBytes += file.originalSize;
      if (declaredInflatedBytes > caps.maxUncompressedBytes) {
        fatalReason = 'zip-bomb';
        file.terminate();
        return;
      }
    }

    const chunks: Uint8Array[] = [];
    let entryBytes = 0;
    let rejected = false;
    activeEntries += 1;
    file.ondata = (error, chunk, final) => {
      if (fatalReason || rejected) return;
      if (error) {
        fatalReason = 'malformed-zip';
        return;
      }

      entryBytes += chunk.byteLength;
      totalInflatedBytes += chunk.byteLength;
      if (totalInflatedBytes > caps.maxUncompressedBytes) {
        fatalReason = 'zip-bomb';
        file.terminate();
        return;
      }
      if (entryBytes > caps.maxEntryBytes) {
        rejected = true;
        rejects.push({ path: safe, reason: 'entry-too-large' });
        activeEntries -= 1;
        file.terminate();
        return;
      }

      chunks.push(chunk);
      if (!final) return;
      activeEntries -= 1;
      const bytes = concatByteChunks(chunks, entryBytes);
      if (isManifest) {
        manifest = parseManifest(bytes);
      } else {
        totalBytes += bytes.byteLength;
        files.push({ path: safe, bytes });
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);

  try {
    // Incremental input bounds the inflater's maximum overshoot before its
    // output callback can terminate a dishonest entry.
    const inputChunkBytes = 4 * 1024;
    for (let offset = 0; offset < zipBytes.byteLength && !fatalReason; ) {
      const nextOffset = Math.min(offset + inputChunkBytes, zipBytes.byteLength);
      unzip.push(
        zipBytes.subarray(offset, nextOffset),
        nextOffset === zipBytes.byteLength
      );
      offset = nextOffset;
    }
  } catch {
    return { ok: false, reason: 'malformed-zip' };
  }

  if (fatalReason) return { ok: false, reason: fatalReason };
  if (activeEntries !== 0) return { ok: false, reason: 'malformed-zip' };

  if (files.length === 0) {
    return { ok: false, reason: 'no-files' };
  }
  return { ok: true, manifest, files, rejects, totalBytes };
}

function concatByteChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function hasZipEndRecord(bytes: Uint8Array): boolean {
  // EOCD is at least 22 bytes and may be followed by a 65,535-byte comment.
  // Scanning that bounded suffix distinguishes arbitrary input from an empty
  // (but structurally valid) archive before fflate's streaming parser starts.
  const minimumOffset = Math.max(0, bytes.byteLength - (22 + 0xffff));
  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return true;
    }
  }
  return false;
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

/**
 * Decode UTF-8 bytes to a string without depending on the DOM
 * `TextDecoder` typings vs. node's — `TextDecoder` is global in both
 * modern Node (>=11) and every browser, so a direct call stays
 * isomorphic.
 */
function strU8ToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
