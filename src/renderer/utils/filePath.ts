/**
 * Cross-platform path helpers used by renderer surfaces that need to
 * speak to the RL-077 capability bridge.
 *
 * The renderer never sees Node's `path` module; both Windows (`\\`) and
 * POSIX (`/`) separators can show up in absolute paths arriving from
 * sessions, recent files, or deep-link URIs. These helpers stay tiny
 * and intentionally string-based so they work the same in Electron and
 * in the web build.
 */

/**
 * Split an absolute file path into `{ parent, basename }`. The parent
 * is whatever sits before the LAST separator; the basename is the
 * trailing segment. Falls back to returning the input unchanged when
 * no separator is found or the separator is at index 0 (e.g. `/foo`),
 * because re-minting against `/` is a meaningless operation.
 */
export function parentDirOf(absolutePath: string): {
  parent: string;
  basename: string;
} {
  const sep = absolutePath.includes('\\') ? '\\' : '/';
  const idx = absolutePath.lastIndexOf(sep);
  if (idx <= 0) {
    return { parent: absolutePath, basename: absolutePath };
  }
  return {
    parent: absolutePath.slice(0, idx),
    basename: absolutePath.slice(idx + 1),
  };
}

/**
 * Join an approved root path with a relative path inside it, producing
 * the display-only absolute path that surfaces in tab tooltips,
 * `sessionStore` persistence rows, and recent-files entries.
 *
 * The renderer must NEVER pass the result of `joinAbsolute` back to
 * any `window.lingua.fs.*` IPC channel — those take `(rootId,
 * relativePath)` exclusively. This helper exists only so callers can
 * stop hand-stringing `${rootPath}/${relative}` everywhere.
 */
export function joinAbsolute(rootPath: string, relative: string): string {
  if (!relative) return rootPath;
  const sep = rootPath.includes('\\') ? '\\' : '/';
  const trimmedRoot = rootPath.endsWith(sep) ? rootPath.slice(0, -1) : rootPath;
  const trimmedRel = relative.replace(/^[\\/]+/, '').replace(/[\\/]/g, sep);
  return `${trimmedRoot}${sep}${trimmedRel}`;
}

export function pathToFileUri(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/');
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///';
  return prefix + encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

export function rustLspModelPathForTab(tab: {
  id: string;
  name: string;
  filePath?: string;
}): string {
  if (tab.filePath) return pathToFileUri(tab.filePath);

  const fileName = tab.name.endsWith('.rs') ? tab.name : `${tab.name}.rs`;
  return `file:///__lingua_unsaved__/${encodeURIComponent(tab.id)}/${encodeURIComponent(
    fileName
  )}`;
}
