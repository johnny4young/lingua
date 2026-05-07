/**
 * RL-087 — single source of truth for path prefixes that should never
 * trigger re-index work in the renderer (or, in future tickets,
 * search-in-files / find-in-tree / project-wide indexing).
 *
 * The list deliberately stays short and conservative — directories
 * that are universally generated (`dist/`, `out/`), tooling caches
 * (`.vite/`, `__pycache__/`, `.pytest_cache/`), or framework-specific
 * build artefacts (`.next/`). Source-of-truth language directories
 * (`src/`, `lib/`, `app/`) are NEVER ignored even if they contain
 * generated files; the ignore policy is by directory name, not by
 * generation status.
 *
 * Pure module. No Node, no React, no Electron — so the renderer can
 * import it without dragging unwanted globals into its bundle.
 */

export const IGNORED_PATH_PREFIXES: readonly string[] = [
  'node_modules/',
  '.git/',
  '.vite/',
  'dist/',
  'out/',
  '.next/',
  'build/',
  '__pycache__/',
  '.pytest_cache/',
];

/**
 * True when the given path is inside one of the ignored prefixes (or
 * is the prefix itself). Normalizes Windows backslashes to forward
 * slashes before matching so the same list works cross-platform.
 *
 * Edge cases:
 *   - Empty string → false (the project root itself is not ignored).
 *   - Exact directory name without trailing slash (e.g. `'node_modules'`)
 *     → true.
 *   - Sub-path inside an ignored directory (e.g. `'node_modules/foo'`)
 *     → true.
 *   - Sibling that happens to share a prefix substring (e.g.
 *     `'node_modules_backup/foo'`) → false.
 */
export function isIgnoredPath(relativePath: string): boolean {
  if (!relativePath) return false;

  const normalized = relativePath.replace(/\\/g, '/');

  return IGNORED_PATH_PREFIXES.some((prefix) => {
    // `prefix` always ends with `/`, e.g. `'node_modules/'`.
    // Match either an exact bare name (`'node_modules'`) or a path
    // descendant (`'node_modules/foo'`). The bare-name match drops the
    // trailing slash from the comparison.
    const prefixWithoutSlash = prefix.slice(0, -1);
    return normalized === prefixWithoutSlash || normalized.startsWith(prefix);
  });
}
