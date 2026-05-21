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

/**
 * RL-024 Slice 1 fold E — smart-truncate a long project root path
 * for tooltips and the FileTree header. Three rules, applied in
 * order:
 *
 *   1. If the path starts with the user's home directory token
 *      (`/Users/<user>` on macOS, `/home/<user>` on Linux, common
 *      `C:\\Users\\<user>` shape on Windows), collapse it to `~`.
 *   2. If the result is still longer than `maxLength`, keep the
 *      first segment + last two segments and elide the middle as
 *      `…`. Example: `/very/long/deeply/nested/project` →
 *      `/very/.../nested/project`.
 *   3. Otherwise return as-is.
 *
 * Pure helper — no `process.env.HOME` lookup; the caller passes the
 * home prefix in (the web build has no concept of a home, and the
 * desktop renderer reads it from a small IPC). Defaulting to `''`
 * means "skip step 1".
 */
export function smartTruncatePath(
  absolutePath: string,
  options: { homePrefix?: string; maxLength?: number } = {}
): string {
  const { homePrefix = '', maxLength = 48 } = options;
  let working = absolutePath;
  if (homePrefix && homePrefix.length > 0) {
    // Normalise both sides to forward slashes for prefix matching, then
    // restore the OS separator on the rebuilt path.
    const normalisedHome = homePrefix.replace(/\\/g, '/').replace(/\/+$/, '');
    const normalisedPath = working.replace(/\\/g, '/');
    if (
      normalisedHome.length > 0 &&
      (normalisedPath === normalisedHome ||
        normalisedPath.startsWith(`${normalisedHome}/`))
    ) {
      working = `~${normalisedPath.slice(normalisedHome.length)}`;
    }
  }
  if (working.length <= maxLength) return working;
  const sep = working.includes('\\') ? '\\' : '/';
  const segments = working.split(sep).filter(Boolean);
  if (segments.length <= 3) return working;
  const head = segments[0]!;
  const tailA = segments[segments.length - 2]!;
  const tailB = segments[segments.length - 1]!;
  const prefix = working.startsWith(sep) ? sep : '';
  // Special-case the home-token short prefix so it survives the
  // ellipsis collapse (e.g. `~/.../project`).
  const headPart = head.startsWith('~') ? head : `${prefix}${head}`;
  return `${headPart}${sep}…${sep}${tailA}${sep}${tailB}`;
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
