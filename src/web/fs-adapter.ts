/**
 * Web File System Adapter
 *
 * Implements the LinguaAPI `fs` namespace using the browser's File
 * System Access API (showDirectoryPicker / showOpenFilePicker), with
 * a synthetic capability registry mirroring the desktop sandbox shape
 *. Pickers mint synthetic `rootId` strings keyed to the FSA
 * `FileSystemDirectoryHandle` they returned; subsequent operations
 * supply `{ rootId, relativePath }` and the adapter walks the
 * approved root's handle tree to reach the target.
 *
 * Limitations vs. the Electron version:
 *  - `watchStart` / `watchStop` are no-ops (no native FS watchers).
 *  - `onChanged` callback is never called.
 *  - `rename` is read+write+delete since FSA has no native rename.
 */

import { OPEN_FILE_PICKER_TYPES } from '../shared/filePickerTypes';
import { useUIStore } from '../renderer/stores/uiStore';
import { trackEvent } from '../renderer/utils/telemetry';
import {
  asRelativePath,
  asRootId,
  asWatchId,
  type RelativePath,
  type RootId,
  type WatchId,
} from '../shared/fs/brandedIds';

// -------------------------------- Minimal File System Access API types

interface FileSystemPickerWindow {
  showDirectoryPicker(opts?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker(opts?: {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: Array<{
      description?: string;
      accept?: Record<string, string[]>;
    }>;
  }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(opts?: { suggestedName?: string }): Promise<FileSystemFileHandle>;
}

// TS 6 tightened the DOM lib so `FileSystemDirectoryHandle.entries()` now
// returns a `FileSystemDirectoryHandleAsyncIterator<...>` (a full async
// iterator with `next`), not just an `AsyncIterable<...>`. The runtime
// surface is the same — the browser still yields entries via `for await` —
// but the declared shape narrowed. We model the same iterator type so the
// helper's downstream callers still get the precise entry tuple.
interface IterableFileSystemDirectoryHandle extends FileSystemDirectoryHandle {
  entries(): FileSystemDirectoryHandleAsyncIterator<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  >;
}

// ----------------------------------------------------- capability registry

interface CapabilityEntry {
  /** Synthetic absolute path; the FSA web build does not expose real
   *  filesystem paths so we fabricate one for tooltips / display. */
  rootPath: string;
  rootHandle: FileSystemDirectoryHandle;
}

const REGISTRY = new Map<string, CapabilityEntry>();

function mintCapability(
  rootHandle: FileSystemDirectoryHandle,
  displayName: string,
  rootPathOverride?: string
): { rootId: RootId; rootPath: string } {
  // Web mint authority: the FSA adapter is the web-side equivalent of
  // main's capability registry, so branding the generated token here is
  // the sanctioned mint point for a web `RootId`.
  const rootId = asRootId(
    (crypto as Crypto & { randomUUID?: () => string }).randomUUID
      ? crypto.randomUUID()
      : `web-cap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  const rootPath = rootPathOverride ?? `/${displayName}`;
  REGISTRY.set(rootId, { rootHandle, rootPath });
  return { rootId, rootPath };
}

function lookupCapability(rootId: string): CapabilityEntry | null {
  return REGISTRY.get(rootId) ?? null;
}

// ----------------------------------------------------- path helpers

function joinRelative(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/$/, '');
}

const NUL = String.fromCharCode(0);

function isSafeEntryName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed !== '.' &&
    trimmed !== '..' &&
    !trimmed.includes(NUL) &&
    !/[\\/]/.test(trimmed)
  );
}

function rejectsTraversal(relativePath: string): boolean {
  if (relativePath.length === 0) return false;
  if (relativePath.includes(NUL)) return true;
  // Parity with the desktop registry: an absolute path is never a
  // valid relative path inside an approved root, even though FSA
  // handles are already sandboxed by the browser. Catches POSIX
  // leading-slash, UNC paths, and Windows drive letters.
  if (
    relativePath.startsWith('/') ||
    relativePath.startsWith('\\') ||
    /^[A-Za-z]:/.test(relativePath)
  ) {
    return true;
  }
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  return segments.some((segment) => !isSafeEntryName(segment));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coercePositiveLimit(
  value: unknown,
  fallback: number,
  max: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.floor(value)));
}

async function resolveHandle(
  rootId: string,
  relativePath: string
): Promise<{
  entry: CapabilityEntry;
  handle: FileSystemFileHandle | FileSystemDirectoryHandle | null;
}> {
  const entry = lookupCapability(rootId);
  if (!entry) {
    throw new Error('unknown-root');
  }
  if (rejectsTraversal(relativePath)) {
    throw new Error('unsafe-path');
  }

  if (relativePath.length === 0 || relativePath === '/') {
    return { entry, handle: entry.rootHandle };
  }

  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  let current: FileSystemDirectoryHandle = entry.rootHandle;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const isLast = i === parts.length - 1;
    try {
      if (isLast) {
        try {
          const fh = await current.getFileHandle(part);
          return { entry, handle: fh };
        } catch {
          const dh = await current.getDirectoryHandle(part);
          return { entry, handle: dh };
        }
      } else {
        current = await current.getDirectoryHandle(part);
      }
    } catch {
      return { entry, handle: null };
    }
  }
  return { entry, handle: current };
}

async function ensureParentDir(
  entry: CapabilityEntry,
  relativePath: string,
  create: boolean
): Promise<{ dir: FileSystemDirectoryHandle; basename: string } | null> {
  if (rejectsTraversal(relativePath)) return null;
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return null;
  const basename = parts.pop()!;
  if (!isSafeEntryName(basename)) return null;
  let dir: FileSystemDirectoryHandle = entry.rootHandle;
  for (const part of parts) {
    try {
      dir = await dir.getDirectoryHandle(part, { create });
    } catch {
      return null;
    }
  }
  return { dir, basename };
}

const HIDDEN_NAMES = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'target',
  '__pycache__',
  '.DS_Store',
  'Thumbs.db',
  '.idea',
  '.vscode',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
]);

function shouldHide(name: string): boolean {
  if (HIDDEN_NAMES.has(name)) return true;
  return name.startsWith('.') && name !== '.env' && name !== '.gitignore';
}

// ----------------------------------------------------- fs adapter

/**
 * implementation — bucket the user agent into one of the
 * `FS_DIRECTORY_PICKER_UA_BUCKETS` closed-enum values for the
 * `runtime.fs_directory_picker_unsupported` telemetry. Order matters:
 * Safari and Edge both inject their tokens into UA strings that also
 * mention "Chrome", so the Safari / Edge checks need to come first.
 */
function bucketUserAgent(ua: string): 'safari' | 'firefox' | 'edge-old' | 'other' {
  const lower = ua.toLowerCase();
  // Edge legacy (pre-Chromium) — `'edge/'` substring; Chromium-based
  // Edge sticks to `'edg/'` and does support the API today.
  if (lower.includes('edge/')) return 'edge-old';
  // Safari ships WebKit; the `'safari/'` token is the canonical
  // mobile + desktop marker, but Chrome / Chromium on macOS also
  // includes it, and Chrome for iOS uses `'crios/'` (with `'safari/'`
  // suffixed but no `'chrome/'`). Exclude all three explicitly so
  // the bucket actually represents "real Safari", not "any WebKit-
  // family UA".
  if (
    lower.includes('safari/') &&
    !lower.includes('chrome/') &&
    !lower.includes('chromium/') &&
    !lower.includes('crios/')
  ) {
    return 'safari';
  }
  if (lower.includes('firefox/')) return 'firefox';
  return 'other';
}

let directoryPickerUnsupportedReported = false;
const DIRECTORY_UNSUPPORTED_NOTICE_DEBOUNCE_MS = 1500;
let lastDirectoryUnsupportedNoticeAt = Number.NEGATIVE_INFINITY;

export function _resetWebFsAdapterUnsupportedStateForTests(): void {
  directoryPickerUnsupportedReported = false;
  lastDirectoryUnsupportedNoticeAt = Number.NEGATIVE_INFINITY;
}

function emitDirectoryPickerUnsupportedOnce(): void {
  if (directoryPickerUnsupportedReported) return;
  directoryPickerUnsupportedReported = true;
  // Both `uiStore` and `telemetry` are already in the web main bundle
  // via other consumers, so the static imports at the top of this file
  // do not widen the initial bundle beyond modules already loaded.
  try {
    const ua =
      typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
        ? navigator.userAgent
        : '';
    void trackEvent('runtime.fs_directory_picker_unsupported', {
      userAgentBucket: bucketUserAgent(ua),
    });
  } catch {
    /* swallow — telemetry must never block the UX */
  }
}

function pushDirectoryUnsupportedNoticeDebounced(): void {
  const now = Date.now();
  if (
    now - lastDirectoryUnsupportedNoticeAt <
    DIRECTORY_UNSUPPORTED_NOTICE_DEBOUNCE_MS
  ) {
    return;
  }
  lastDirectoryUnsupportedNoticeAt = now;
  try {
    useUIStore.getState().pushStatusNotice({
      tone: 'warning',
      messageKey: 'fileTree.web.directoryUnsupported',
    });
  } catch {
    /* swallow */
  }
}

export const webFsAdapter: LinguaAPI['fs'] = {
  selectDirectory: async () => {
    const picker = window as unknown as FileSystemPickerWindow;
    // implementation — probe before invoking. The pre-internal
    // implementation wrapped `showDirectoryPicker(...)` in a bare
    // try/catch which collapsed "user clicked cancel" and "the API
    // is not implemented" into the same `{ canceled: true }` result.
    // On Safari / older Firefox, "Open folder" looked silently dead.
    // We now distinguish the two:
    //   - API missing  → status notice + closed-enum telemetry
    //                    (so dashboards can count how often users hit
    //                     this wall before we ship a richer fallback)
    //   - user cancel  → unchanged silent `{ canceled: true }`.
    if (typeof picker.showDirectoryPicker !== 'function') {
      // Fire-and-forget: telemetry + notice are both best-effort.
      emitDirectoryPickerUnsupportedOnce();
      pushDirectoryUnsupportedNoticeDebounced();
      return { canceled: true } as const;
    }
    try {
      const dh = await picker.showDirectoryPicker({ mode: 'readwrite' });
      const { rootId, rootPath } = mintCapability(dh, dh.name);
      return { canceled: false, rootId, rootPath } as const;
    } catch {
      return { canceled: true } as const;
    }
  },

  selectFile: async () => {
    try {
      const picker = window as unknown as FileSystemPickerWindow;
      const [fh] = await picker.showOpenFilePicker({
        multiple: false,
        excludeAcceptAllOption: true,
        types: OPEN_FILE_PICKER_TYPES.map((type) => ({
          description: type.description,
          accept: Object.fromEntries(
            Object.entries(type.accept).map(([mimeType, extensions]) => [
              mimeType,
              [...extensions],
            ])
          ),
        })),
      });
      if (!fh) return { canceled: true } as const;

      // The File System Access API only hands back a `FileSystemFileHandle`
      // — we never see the parent directory, so we cannot mint a normal
      // root capability over the user's chosen folder. The proxy
      // directory below is a synthetic root that exposes exactly one
      // entry (the picked file). Reads of any other relative path fail
      // with `NotFoundError`, mirroring the desktop "approved single
      // file" semantics through the same `{ rootId, relativePath }`
      // contract.
      const file = await fh.getFile();
      const content = await file.text();
      const fileName = fh.name;
      const proxyDir: FileSystemDirectoryHandle = {
        kind: 'directory',
        name: '_lingua_single_file_root',
        async getFileHandle(name: string) {
          if (name === fileName) return fh;
          throw new Error('NotFoundError');
        },
        async getDirectoryHandle() {
          throw new Error('NotFoundError');
        },
        async removeEntry() {
          /* no-op */
        },
        async resolve() {
          return null;
        },
      } as unknown as FileSystemDirectoryHandle;
      const { rootId, rootPath } = mintCapability(proxyDir, fileName, '/');
      return {
        canceled: false,
        rootId,
        rootPath,
        fileRelativePath: asRelativePath(fileName),
        fileName,
        content,
      } as const;
    } catch {
      return { canceled: true } as const;
    }
  },

  saveDialog: async (defaultName: string) => {
    try {
      const picker = window as unknown as FileSystemPickerWindow;
      const fh = await picker.showSaveFilePicker({ suggestedName: defaultName });
      const fileName = fh.name;
      const proxyDir: FileSystemDirectoryHandle = {
        kind: 'directory',
        name: '_lingua_single_file_root',
        async getFileHandle(name: string) {
          if (name === fileName) return fh;
          throw new Error('NotFoundError');
        },
        async getDirectoryHandle() {
          throw new Error('NotFoundError');
        },
        async removeEntry() {
          /* no-op */
        },
        async resolve() {
          return null;
        },
      } as unknown as FileSystemDirectoryHandle;
      const { rootId, rootPath } = mintCapability(proxyDir, fileName, '/');
      return {
        canceled: false,
        rootId,
        rootPath,
        fileRelativePath: asRelativePath(fileName),
      } as const;
    } catch {
      return { canceled: true } as const;
    }
  },

  reopenRoot: async (_absolutePath: string) => {
    // The web adapter has no FSA equivalent of "remember a path across
    // sessions"; users must re-pick the directory through the FSA
    // permission prompt. Surface this as not-found so the renderer
    // knows to drive the user back through `selectDirectory`.
    return { ok: false, error: 'not-found' } as const;
  },

  reopenFile: async (_absolutePath: string) => {
    return { ok: false, error: 'not-found' } as const;
  },

  // implementation detail — the web FSA sandbox has no OS-path denylist (every
  // handle is user-granted through the picker), so nothing is ever classified
  // as blocked here.
  classifyBlockedPath: async (_absolutePath: string) => {
    return { family: null } as const;
  },

  revokeRoot: async (rootId: string) => REGISTRY.delete(rootId),

  readdir: async (rootId: string, relativePath: string): Promise<FsDirEntry[]> => {
    const { handle } = await resolveHandle(rootId, relativePath);
    if (!handle || handle.kind !== 'directory') return [];
    const dh = handle as IterableFileSystemDirectoryHandle;
    const entries: FsDirEntry[] = [];
    for await (const [name, entry] of dh.entries()) {
      if (shouldHide(name)) continue;
      entries.push({
        name,
        isDirectory: entry.kind === 'directory',
        relativePath: asRelativePath(joinRelative(relativePath, name)),
      });
    }
    return entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  },

  listAllFiles: async (
    rootId: string,
    relativePath: string = ''
  ): Promise<FsIndexedFile[]> => {
    const { handle } = await resolveHandle(rootId, relativePath);
    if (!handle || handle.kind !== 'directory') return [];

    const MAX_FILES = 20_000;
    const results: FsIndexedFile[] = [];

    async function walk(
      dirHandle: IterableFileSystemDirectoryHandle,
      currentRelative: string
    ): Promise<void> {
      if (results.length >= MAX_FILES) return;
      for await (const [name, entry] of dirHandle.entries()) {
        if (results.length >= MAX_FILES) return;
        if (shouldHide(name)) continue;
        const nextRelative = joinRelative(currentRelative, name);
        if (entry.kind === 'directory') {
          await walk(entry as IterableFileSystemDirectoryHandle, nextRelative);
          continue;
        }
        results.push({ name, relativePath: asRelativePath(nextRelative) });
      }
    }

    await walk(handle as IterableFileSystemDirectoryHandle, relativePath);
    return results;
  },

  searchInFiles: async (
    rootId: RootId,
    relativePath: RelativePath,
    query: string,
    options: FsSearchOptions = {}
  ): Promise<FsSearchResult[]> => {
    if (typeof query !== 'string') return [];
    const safeOptions = isRecord(options) ? options : {};
    const searchText = query;
    if (searchText.length === 0) return [];

    const caseSensitive = safeOptions.caseSensitive === true;
    const maxMatchesPerFile = coercePositiveLimit(
      safeOptions.maxMatchesPerFile,
      20,
      200
    );
    const maxTotalMatches = coercePositiveLimit(
      safeOptions.maxTotalMatches,
      500,
      5_000
    );
    const maxFileSize = coercePositiveLimit(
      safeOptions.maxFileSize,
      1_000_000,
      1_000_000
    );
    const maxFilesScanned = coercePositiveLimit(
      safeOptions.maxFilesScanned,
      5_000,
      20_000
    );

    const needle = caseSensitive ? searchText : searchText.toLowerCase();
    const files = await webFsAdapter.listAllFiles(rootId, relativePath);
    const results: FsSearchResult[] = [];
    let totalMatches = 0;
    let filesScanned = 0;

    for (const file of files) {
      if (totalMatches >= maxTotalMatches || filesScanned >= maxFilesScanned) {
        break;
      }
      filesScanned += 1;

      let handle;
      try {
        const resolved = await resolveHandle(rootId, file.relativePath);
        handle = resolved.handle;
      } catch {
        continue;
      }
      if (!handle || handle.kind !== 'file') continue;

      let blob: File;
      try {
        blob = await (handle as FileSystemFileHandle).getFile();
      } catch {
        continue;
      }
      if (blob.size > maxFileSize) continue;

      let content: string;
      try {
        content = await blob.text();
      } catch {
        continue;
      }

      if (content.slice(0, 1024).includes(NUL)) continue;

      const matches: FsSearchMatch[] = [];
      const lines = content.split(/\r?\n/);

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (matches.length >= maxMatchesPerFile) break;
        if (totalMatches + matches.length >= maxTotalMatches) break;
        const rawLine = lines[lineIndex] ?? '';
        const haystack = caseSensitive ? rawLine : rawLine.toLowerCase();
        const column = haystack.indexOf(needle);
        if (column === -1) continue;

        const PREVIEW_BUDGET = 240;
        const previewStart = Math.max(0, column - 80);
        const previewEnd = Math.min(rawLine.length, previewStart + PREVIEW_BUDGET);
        matches.push({
          line: lineIndex + 1,
          column: column + 1,
          preview: rawLine.slice(previewStart, previewEnd),
          matchStart: column - previewStart,
          matchEnd: column - previewStart + searchText.length,
        });
      }

      if (matches.length > 0) {
        results.push({ relativePath: file.relativePath, matches });
        totalMatches += matches.length;
      }
    }

    return results;
  },

  // implementation — web does not expose a replace-in-files API (no
  // atomic-rename primitive over the File System Access API; the
  // safe-by-default posture is to disable the action entirely and
  // surface "Open Lingua Desktop" copy via the panel context). Both
  // stubs return empty / unsupported so the renderer guards work.
  replaceInFiles: async (): Promise<FsReplaceResult[]> => [],
  applyReplaceInFile: async (): Promise<FsApplyReplaceResult> => ({
    ok: false,
    replaced: 0,
    reason: 'unsupported',
  }),

  stat: async (rootId: string, relativePath: string): Promise<FsStatResult> => {
    const { handle } = await resolveHandle(rootId, relativePath);
    if (!handle) {
      throw new Error(`File not found: ${relativePath}`);
    }
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile();
      const now = new Date().toISOString();
      return {
        size: file.size,
        isDirectory: false,
        isFile: true,
        mtime: new Date(file.lastModified).toISOString(),
        ctime: now,
      };
    }
    return {
      size: 0,
      isDirectory: true,
      isFile: false,
      mtime: new Date().toISOString(),
      ctime: new Date().toISOString(),
    };
  },

  read: async (rootId: string, relativePath: string): Promise<string> => {
    const { handle } = await resolveHandle(rootId, relativePath);
    if (!handle || handle.kind !== 'file') {
      throw new Error(`Cannot read: ${relativePath}`);
    }
    const file = await (handle as FileSystemFileHandle).getFile();
    return file.text();
  },

  write: async (
    rootId: string,
    relativePath: string,
    content: string
  ): Promise<boolean> => {
    const entry = lookupCapability(rootId);
    if (!entry) return false;
    const ensure = await ensureParentDir(entry, relativePath, true);
    if (!ensure) return false;
    try {
      const fh = await ensure.dir.getFileHandle(ensure.basename, { create: true });
      const writable = await fh.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch {
      return false;
    }
  },

  delete: async (
    rootId: string,
    relativePath: string,
    isDirectory = false
  ): Promise<boolean> => {
    const entry = lookupCapability(rootId);
    if (!entry) return false;
    const ensure = await ensureParentDir(entry, relativePath, false);
    if (!ensure) return false;
    try {
      await ensure.dir.removeEntry(ensure.basename, { recursive: isDirectory });
      return true;
    } catch {
      return false;
    }
  },

  rename: async (
    rootId: RootId,
    relativeOldPath: RelativePath,
    newName: string
  ): Promise<RelativePath> => {
    if (!isSafeEntryName(newName)) {
      throw new Error('unsafe-path');
    }
    // FSA has no native rename; read + write under the new relative
    // path + delete the old one. Stays inside the same capability so
    // the renderer never juggles a fresh rootId.
    const content = await webFsAdapter.read(rootId, relativeOldPath);
    const lastSlash = relativeOldPath.lastIndexOf('/');
    const dir = lastSlash >= 0 ? relativeOldPath.slice(0, lastSlash) : '';
    const newRelative = asRelativePath(joinRelative(dir, newName));
    const wrote = await webFsAdapter.write(rootId, newRelative, content);
    if (!wrote) {
      throw new Error('write-failed');
    }
    const deleted = await webFsAdapter.delete(rootId, relativeOldPath);
    if (!deleted) {
      throw new Error('delete-failed');
    }
    return newRelative;
  },

  mkdir: async (rootId: string, relativePath: string): Promise<boolean> => {
    const entry = lookupCapability(rootId);
    if (!entry) return false;
    if (rejectsTraversal(relativePath)) return false;
    try {
      const parts = relativePath.split(/[\\/]/).filter(Boolean);
      let dir: FileSystemDirectoryHandle = entry.rootHandle;
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      return true;
    } catch {
      return false;
    }
  },

  touch: async (rootId: RootId, relativePath: RelativePath): Promise<boolean> => {
    const entry = lookupCapability(rootId);
    if (!entry) return false;
    try {
      const { handle } = await resolveHandle(rootId, relativePath);
      if (handle) return true;
    } catch {
      // resolveHandle throws on traversal; fall through to write so the
      // user-facing failure is consistent (write returns false).
    }
    return webFsAdapter.write(rootId, relativePath, '');
  },

  // implementation note — the web build has no concept of an OS
  // file manager, so "Reveal in Finder" is a no-op that resolves to
  // `false` (consistent with the rest of the adapter's "feature
  // unsupported here" convention). The renderer treats `false` as "do
  // not surface the menu item" — see `FileTreeNode`'s context menu.
  revealInFinder: async (
    _rootId: string,
    _relativePath: string,
  ): Promise<boolean> => {
    return false;
  },

  // implementation — project zip bundles. The web build branches on
  // `platform === 'web'` BEFORE calling these (export does an in-renderer
  // Blob download via the shared `packBundle`; import surfaces
  // `projectBundle.web.unsupported`), so these stubs only exist to keep
  // the `window.lingua.fs` contract uniform and resolve to an honest
  // failure if ever reached from a non-UI surface.
  exportBundle: async (
    _rootId: string,
    _opts?: { entryFile?: string; languageHint?: string },
  ): Promise<
    | { ok: true; fileCount: number; byteLength: number }
    | { canceled: true }
    | { ok: false; reason: 'empty' | 'too-many-files' | 'write-failed' }
  > => {
    return { ok: false, reason: 'write-failed' } as const;
  },

  importBundle: async (
    _zipBytes: Uint8Array,
  ): Promise<
    | { ok: true; rootPath: string; fileCount: number; entryFile?: string }
    | { canceled: true }
    | {
        ok: false;
        reason:
          | 'empty'
          | 'entry-too-large'
          | 'malformed-zip'
          | 'no-files'
          | 'path-traversal'
          | 'too-large'
          | 'too-many-files'
          | 'zip-bomb'
          | 'non-empty-dir'
          | 'write-failed';
      }
  > => {
    return { ok: false, reason: 'write-failed' } as const;
  },

  watchStart: async (
    _rootId: RootId,
    _relativePath?: RelativePath,
  ): Promise<WatchId | { ok: false; diagnostic: WatcherDiagnostic }> => {
    return asWatchId('web-noop-watcher');
  },

  watchStop: async (_watchId: WatchId): Promise<boolean> => {
    return true;
  },

  onChanged: (_callback: (event: FsChangedEvent) => void): (() => void) => {
    // No-op on web — return a no-op unsubscribe function.
    return () => {};
  },

  // internal — web has no native watcher, so failure / degraded events
  // never fire. The subscription methods exist to keep the renderer
  // contract uniform across platforms (web, desktop, future targets).
  onWatcherFailed: (
    _callback: (diagnostic: WatcherDiagnostic) => void,
  ): (() => void) => {
    return () => {};
  },

  onWatcherDegraded: (
    _callback: (diagnostic: WatcherDiagnostic) => void,
  ): (() => void) => {
    return () => {};
  },
};
