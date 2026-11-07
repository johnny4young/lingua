import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * One-time copy of renderer storage from the file:// origin of older builds to
 * the custom-scheme origin; Chromium keys storage by origin. The legacy copy is
 * left on disk. Retries never overwrite what the new origin holds, and the
 * marker's progress keeps them from restoring what the user deleted since.
 */

export const ORIGIN_MIGRATION_MARKER = 'renderer-origin-migration.json';
export const ORIGIN_MIGRATION_MAX_ATTEMPTS = 3;
export const ORIGIN_MIGRATION_CHUNK_BYTES = 1 << 20;

interface OriginFile {
  path: string[];
  size: number;
}

export interface LegacyOriginReader {
  readLocalStorage: () => Promise<Array<[string, string]>>;
  listFiles: () => Promise<OriginFile[]>;
  readChunk: (path: readonly string[], offset: number, length: number) => Promise<Uint8Array>;
  close: () => void;
}

export interface TargetOriginWriter {
  /** Sets each key the origin does not hold yet; resolves with how many it set. */
  writeLocalStorage: (entries: Array<[string, string]>) => Promise<number>;
  fileSize: (path: readonly string[]) => Promise<number | null>;
  beginFile: (path: readonly string[]) => Promise<void>;
  writeChunk: (bytes: Uint8Array) => Promise<void>;
  endFile: () => Promise<void>;
  abortFile: () => Promise<void>;
  close: () => void;
}

export interface OriginMigrationMarker {
  version: 1;
  state: 'done' | 'failed';
  attempts: number;
  localStorageKeys: number;
  files: number;
  fileBytes: number;
  durationMs: number;
  error?: string;
  localStorageCopied: boolean;
  /** Paths joined with `/`. */
  copiedFiles: string[];
}

export type OriginMigrationResult =
  | { status: 'skipped' }
  | { status: 'empty' | 'migrated' | 'failed'; marker: OriginMigrationMarker };

export interface OriginMigrationDeps {
  userDataDir: string;
  openLegacy: () => Promise<LegacyOriginReader>;
  openTarget: () => Promise<TargetOriginWriter>;
  /** Writes pending localStorage to disk before the marker records success. */
  flush: () => Promise<void> | void;
  signal?: AbortSignal;
  now?: () => number;
}

async function readMarker(markerPath: string): Promise<OriginMigrationMarker | null> {
  try {
    const parsed = JSON.parse(await readFile(markerPath, 'utf8')) as Partial<OriginMigrationMarker>;
    if (parsed?.version !== 1 || (parsed.state !== 'done' && parsed.state !== 'failed')) return null;
    return {
      ...(parsed as OriginMigrationMarker),
      attempts: Number.isInteger(parsed.attempts) ? (parsed.attempts as number) : 1,
      localStorageCopied: parsed.localStorageCopied === true,
      copiedFiles: Array.isArray(parsed.copiedFiles)
        ? parsed.copiedFiles.filter((entry): entry is string => typeof entry === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

async function writeMarker(markerPath: string, marker: OriginMigrationMarker): Promise<void> {
  const temporary = `${markerPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, markerPath);
}

/** An error name or code, never a message: messages can carry paths. */
function errorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const { code, name } = error as { code?: unknown; name?: unknown };
    if (typeof code === 'string' && /^[\w-]{1,64}$/.test(code)) return code;
    if (typeof name === 'string' && /^\w{1,64}$/.test(name)) return name;
  }
  return 'unknown';
}

async function copyFile(
  legacy: LegacyOriginReader,
  target: TargetOriginWriter,
  file: OriginFile,
  signal?: AbortSignal
): Promise<void> {
  await target.beginFile(file.path);
  try {
    for (let offset = 0; offset < file.size; ) {
      signal?.throwIfAborted();
      const length = Math.min(ORIGIN_MIGRATION_CHUNK_BYTES, file.size - offset);
      const bytes = await legacy.readChunk(file.path, offset, length);
      if (bytes.byteLength !== length) {
        throw Object.assign(new Error('Legacy file changed during migration'), { code: 'ESIZE' });
      }
      await target.writeChunk(bytes);
      offset += length;
    }
    await target.endFile();
  } catch (error) {
    await target.abortFile().catch(() => {});
    throw error;
  }
  if ((await target.fileSize(file.path)) !== file.size) {
    throw Object.assign(new Error('Copied file size differs'), { code: 'ESIZE' });
  }
}

export async function migrateRendererOrigin(
  deps: OriginMigrationDeps
): Promise<OriginMigrationResult> {
  const now = deps.now ?? Date.now;
  const markerPath = path.join(deps.userDataDir, ORIGIN_MIGRATION_MARKER);
  const previous = await readMarker(markerPath);
  if (
    previous &&
    (previous.state === 'done' || previous.attempts >= ORIGIN_MIGRATION_MAX_ATTEMPTS)
  ) {
    return { status: 'skipped' };
  }

  const started = now();
  // Recorded as interrupted up front, so a crash mid-copy still spends an attempt.
  const marker: OriginMigrationMarker = {
    version: 1,
    state: 'failed',
    error: 'interrupted',
    attempts: (previous?.attempts ?? 0) + 1,
    localStorageKeys: previous?.localStorageKeys ?? 0,
    files: previous?.files ?? 0,
    fileBytes: previous?.fileBytes ?? 0,
    durationMs: 0,
    localStorageCopied: previous?.localStorageCopied ?? false,
    copiedFiles: previous?.copiedFiles ?? [],
  };
  // No disk probe: Chromium creates Local Storage before any page loads, so only
  // the legacy origin itself can say whether it holds data.
  let legacy: LegacyOriginReader | undefined;
  let target: TargetOriginWriter | undefined;
  try {
    await writeMarker(markerPath, marker);
    legacy = await deps.openLegacy();
    // Settings go first, so a failed file step cannot leave the app to boot on defaults.
    if (!marker.localStorageCopied) {
      const entries = await legacy.readLocalStorage();
      if (entries.length > 0) {
        target = await deps.openTarget();
        marker.localStorageKeys = await target.writeLocalStorage(entries);
        await deps.flush();
      }
      marker.localStorageCopied = true;
      await writeMarker(markerPath, marker);
    }
    const files = (await legacy.listFiles()).filter(
      file => !marker.copiedFiles.includes(file.path.join('/'))
    );
    if (files.length > 0) target ??= await deps.openTarget();
    const empty = !target;
    for (const file of files) {
      deps.signal?.throwIfAborted();
      if (target && ((await target.fileSize(file.path)) ?? 0) === 0) {
        await copyFile(legacy, target, file, deps.signal);
        marker.files += 1;
        marker.fileBytes += file.size;
      }
      marker.copiedFiles = [...marker.copiedFiles, file.path.join('/')];
      await writeMarker(markerPath, marker);
    }
    marker.state = 'done';
    delete marker.error;
    marker.durationMs = Math.round(now() - started);
    await writeMarker(markerPath, marker);
    return { status: empty ? 'empty' : 'migrated', marker };
  } catch (error) {
    marker.state = 'failed';
    marker.error = errorCode(error);
    marker.durationMs = Math.round(now() - started);
    await writeMarker(markerPath, marker).catch(() => {});
    return { status: 'failed', marker };
  } finally {
    legacy?.close();
    target?.close();
  }
}
