/**
 * Web File System Adapter
 *
 * Implements the LinguaAPI `fs` namespace using the browser's
 * File System Access API (showDirectoryPicker / showOpenFilePicker).
 *
 * Limitations vs. the Electron version:
 *  - `watchStart` / `watchStop` are no-ops (no native FS watchers in browser)
 *  - `onChanged` callback is never called
 *  - Paths are virtual "/" separated strings that map to FileSystem handles
 */

// -------------------------------- Minimal File System Access API types
// TypeScript's built-in lib.dom.d.ts may not include these — we define
// a minimal subset to avoid runtime casting.

interface FileSystemPickerWindow {
  showDirectoryPicker(opts?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker(opts?: { multiple?: boolean }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(opts?: { suggestedName?: string }): Promise<FileSystemFileHandle>;
}

interface IterableFileSystemDirectoryHandle extends FileSystemDirectoryHandle {
  entries(): AsyncIterable<[string, FileSystemHandle]>;
}

// ----------------------------------------------------- Handle registry

/** Maps virtual path strings → FileSystem handles for opened entries */
const handleRegistry = new Map<
  string,
  FileSystemFileHandle | FileSystemDirectoryHandle
>();

let rootHandle: FileSystemDirectoryHandle | null = null;
let rootPath = '';

// ----------------------------------------------------- Path helpers

function joinPath(...parts: string[]): string {
  return parts
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

function relativePath(absPath: string): string {
  if (!rootPath) return absPath;
  const rel = absPath.startsWith(rootPath + '/')
    ? absPath.slice(rootPath.length + 1)
    : absPath;
  return rel || '.';
}

async function resolveHandle(
  absPath: string
): Promise<FileSystemFileHandle | FileSystemDirectoryHandle | null> {
  if (handleRegistry.has(absPath)) {
    return handleRegistry.get(absPath)!;
  }
  if (!rootHandle) return null;

  const parts = relativePath(absPath)
    .split('/')
    .filter(Boolean);

  let current: FileSystemDirectoryHandle = rootHandle;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) {
      return null;
    }
    const isLast = i === parts.length - 1;
    try {
      if (isLast) {
        // Try file first, then directory
        try {
          const fh = await current.getFileHandle(part);
          handleRegistry.set(absPath, fh);
          return fh;
        } catch {
          const dh = await current.getDirectoryHandle(part);
          handleRegistry.set(absPath, dh);
          return dh;
        }
      } else {
        current = await current.getDirectoryHandle(part);
      }
    } catch {
      return null;
    }
  }
  return current;
}

// ----------------------------------------------------- fs adapter

export const webFsAdapter: LinguaAPI['fs'] = {
  // Open a directory picker and set it as root
  selectDirectory: async (): Promise<string | null> => {
    try {
      const picker = window as unknown as FileSystemPickerWindow;
      const dh = await picker.showDirectoryPicker({ mode: 'readwrite' });
      rootHandle = dh;
      rootPath = '/' + dh.name;
      handleRegistry.clear();
      handleRegistry.set(rootPath, dh);
      return rootPath;
    } catch {
      // User cancelled
      return null;
    }
  },

  // Save-dialog using File System Access API
  saveDialog: async (defaultName: string): Promise<string | null> => {
    try {
      const picker = window as unknown as FileSystemPickerWindow;
      const fh = await picker.showSaveFilePicker({ suggestedName: defaultName });
      const virtPath = rootPath
        ? joinPath(rootPath, fh.name)
        : '/' + fh.name;
      handleRegistry.set(virtPath, fh);
      return virtPath;
    } catch {
      return null;
    }
  },

  // Open a file picker and return the virtual path
  selectFile: async (): Promise<string | null> => {
    try {
      const picker = window as unknown as FileSystemPickerWindow;
      const [fh] = await picker.showOpenFilePicker({ multiple: false });
      if (!fh) {
        return null;
      }
      const virtPath = rootPath
        ? joinPath(rootPath, fh.name)
        : '/' + fh.name;
      handleRegistry.set(virtPath, fh);
      return virtPath;
    } catch {
      return null;
    }
  },

  readdir: async (dirPath: string): Promise<FsDirEntry[]> => {
    const handle = await resolveHandle(dirPath);
    if (!handle || handle.kind !== 'directory') return [];
    const dh = handle as IterableFileSystemDirectoryHandle;
    const entries: FsDirEntry[] = [];
    for await (const [name, entry] of dh.entries()) {
      entries.push({
        name,
        isDirectory: entry.kind === 'directory',
        path: joinPath(dirPath, name),
      });
    }
    return entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  },

  stat: async (filePath: string): Promise<FsStatResult> => {
    const handle = await resolveHandle(filePath);
    if (!handle) {
      throw new Error(`File not found: ${filePath}`);
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

  read: async (filePath: string): Promise<string> => {
    const handle = await resolveHandle(filePath);
    if (!handle || handle.kind !== 'file') {
      throw new Error(`Cannot read: ${filePath}`);
    }
    const file = await (handle as FileSystemFileHandle).getFile();
    return file.text();
  },

  write: async (filePath: string, content: string): Promise<boolean> => {
    try {
      // Resolve parent directory handle
      const parts = relativePath(filePath).split('/').filter(Boolean);
      const fileName = parts.pop()!;
      let dir: FileSystemDirectoryHandle | null = rootHandle;

      for (const part of parts) {
        if (!dir) return false;
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      if (!dir) return false;

      const fh = await dir.getFileHandle(fileName, { create: true });
      handleRegistry.set(filePath, fh);
      const writable = await fh.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch {
      return false;
    }
  },

  delete: async (filePath: string, isDirectory = false): Promise<boolean> => {
    try {
      const parts = relativePath(filePath).split('/').filter(Boolean);
      const name = parts.pop()!;
      let dir: FileSystemDirectoryHandle | null = rootHandle;

      for (const part of parts) {
        if (!dir) return false;
        dir = await dir.getDirectoryHandle(part);
      }
      if (!dir) return false;

      await dir.removeEntry(name, { recursive: isDirectory });
      handleRegistry.delete(filePath);
      return true;
    } catch {
      return false;
    }
  },

  rename: async (oldPath: string, newName: string): Promise<string> => {
    // File System Access API has no native rename; read+write+delete
    const content = await webFsAdapter.read(oldPath);
    const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newPath = joinPath(dir, newName);
    await webFsAdapter.write(newPath, content);
    await webFsAdapter.delete(oldPath);
    return newPath;
  },

  mkdir: async (dirPath: string): Promise<boolean> => {
    try {
      const parts = relativePath(dirPath).split('/').filter(Boolean);
      let dir: FileSystemDirectoryHandle | null = rootHandle;
      for (const part of parts) {
        if (!dir) return false;
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      if (dir) handleRegistry.set(dirPath, dir);
      return true;
    } catch {
      return false;
    }
  },

  touch: async (filePath: string): Promise<boolean> => {
    try {
      const existing = await resolveHandle(filePath);
      if (existing) return true; // already exists
      return webFsAdapter.write(filePath, '');
    } catch {
      return false;
    }
  },

  // No-ops — browser has no native FS watcher
  watchStart: async (_dirPath: string): Promise<string> => {
    return 'web-noop-watcher';
  },

  watchStop: async (_watchId: string): Promise<boolean> => {
    return true;
  },

  onChanged: (_callback: (event: FsChangedEvent) => void): (() => void) => {
    // No-op on web — return a no-op unsubscribe function
    return () => {};
  },
};
