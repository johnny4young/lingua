/**
 * Web File System Adapter
 *
 * Implements the LinguaAPI `fs` namespace using the browser's File
 * System Access API (showDirectoryPicker / showOpenFilePicker), with
 * a synthetic capability registry mirroring the desktop sandbox shape
 * (RL-077). Pickers mint synthetic `rootId` strings keyed to the FSA
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

interface IterableFileSystemDirectoryHandle extends FileSystemDirectoryHandle {
  entries(): AsyncIterable<[string, FileSystemHandle]>;
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
): { rootId: string; rootPath: string } {
  const rootId = (
    crypto as Crypto & { randomUUID?: () => string }
  ).randomUUID
    ? crypto.randomUUID()
    : `web-cap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

export const webFsAdapter: LinguaAPI['fs'] = {
  selectDirectory: async () => {
    try {
      const picker = window as unknown as FileSystemPickerWindow;
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
        fileRelativePath: fileName,
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
        fileRelativePath: fileName,
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
        relativePath: joinRelative(relativePath, name),
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
        results.push({ name, relativePath: nextRelative });
      }
    }

    await walk(handle as IterableFileSystemDirectoryHandle, relativePath);
    return results;
  },

  searchInFiles: async (
    rootId: string,
    relativePath: string,
    query: string,
    options: FsSearchOptions = {}
  ): Promise<FsSearchResult[]> => {
    const trimmedQuery = query ?? '';
    if (trimmedQuery.length === 0) return [];

    const caseSensitive = options.caseSensitive ?? false;
    const maxMatchesPerFile = Math.max(1, options.maxMatchesPerFile ?? 20);
    const maxTotalMatches = Math.max(1, options.maxTotalMatches ?? 500);
    const maxFileSize = Math.max(1, options.maxFileSize ?? 1_000_000);
    const maxFilesScanned = Math.max(1, options.maxFilesScanned ?? 5_000);

    const needle = caseSensitive ? trimmedQuery : trimmedQuery.toLowerCase();
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
          matchEnd: column - previewStart + trimmedQuery.length,
        });
      }

      if (matches.length > 0) {
        results.push({ relativePath: file.relativePath, matches });
        totalMatches += matches.length;
      }
    }

    return results;
  },

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
    rootId: string,
    relativeOldPath: string,
    newName: string
  ): Promise<string> => {
    if (!isSafeEntryName(newName)) {
      throw new Error('unsafe-path');
    }
    // FSA has no native rename; read + write under the new relative
    // path + delete the old one. Stays inside the same capability so
    // the renderer never juggles a fresh rootId.
    const content = await webFsAdapter.read(rootId, relativeOldPath);
    const lastSlash = relativeOldPath.lastIndexOf('/');
    const dir = lastSlash >= 0 ? relativeOldPath.slice(0, lastSlash) : '';
    const newRelative = joinRelative(dir, newName);
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

  touch: async (rootId: string, relativePath: string): Promise<boolean> => {
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

  watchStart: async (
    _rootId: string,
    _relativePath?: string,
  ): Promise<string | { ok: false; diagnostic: WatcherDiagnostic }> => {
    return 'web-noop-watcher';
  },

  watchStop: async (_watchId: string): Promise<boolean> => {
    return true;
  },

  onChanged: (_callback: (event: FsChangedEvent) => void): (() => void) => {
    // No-op on web — return a no-op unsubscribe function.
    return () => {};
  },

  // RL-087 — web has no native watcher, so failure / degraded events
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
