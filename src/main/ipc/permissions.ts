/**
 * File system permissions layer.
 *
 * Defines which paths are protected against renderer-initiated read / write /
 * delete operations so a misdirected open or save cannot reach OS internals,
 * the user's credentials, other apps' data, browser profiles, or Lingua's own
 * stored state. The denylist is defense-in-depth on top of the capability
 * sandbox; see `docs/security/filesystem-denylist.md` for the rationale and the
 * full family list.
 */

import path from 'node:path';
import os from 'node:os';

const home = os.homedir();
const isWindows = process.platform === 'win32';

/**
 * Coarse category a blocked path belongs to. Used to give the renderer an
 * actionable, localized denial ("this is a browser profile folder") and a
 * privacy-safe telemetry signal — only the family token ever leaves the device,
 * never the path. Tokens are `isSafeToken`-shaped (lowercase, `[a-z0-9._-]`) so
 * the telemetry redactor accepts them as closed-enum values.
 *
 * The tuple is the SINGLE SOURCE OF TRUTH; `src/shared/telemetry.ts` mirrors it
 * as `FS_BLOCKED_FAMILIES` and a parity test cross-imports this export.
 */
export const BLOCKED_PATH_FAMILIES = [
  'system',
  'credentials',
  'app-data',
  'browser-profile',
  'lingua-data',
] as const;

export type BlockedPathFamily = (typeof BLOCKED_PATH_FAMILIES)[number];

/**
 * One protected location plus the family it belongs to. Paths are matched by
 * exact equality or as a path-segment prefix (so `~/.ssh` blocks `~/.ssh/id_rsa`
 * but NOT a sibling `~/.sshconfig`).
 */
interface BlockedPathEntry {
  readonly family: BlockedPathFamily;
  readonly path: string;
}

/**
 * Static denylist. Entries for other OSes are harmless on the current platform
 * (they canonicalize to paths that never match), so the list stays unconditional
 * for readability — mirroring the historical style. macOS `~/Library/Application
 * Support` and Windows `%APPDATA%` are intentionally broad: they cover most app
 * data, the Chromium-family browser profiles nested under them, AND Lingua's own
 * userData, in one entry.
 */
const STATIC_BLOCKED_PATHS: readonly BlockedPathEntry[] = [
  // macOS / Linux system paths
  { family: 'system', path: '/etc' },
  { family: 'system', path: '/System' },
  { family: 'system', path: '/private' },
  { family: 'system', path: '/usr' },
  { family: 'system', path: '/bin' },
  { family: 'system', path: '/sbin' },
  { family: 'system', path: '/lib' },
  { family: 'system', path: '/lib64' },
  { family: 'system', path: '/boot' },
  { family: 'system', path: '/dev' },
  { family: 'system', path: '/proc' },
  { family: 'system', path: '/sys' },
  // Windows system paths
  { family: 'system', path: 'C:\\Windows' },
  { family: 'system', path: 'C:\\Program Files' },
  { family: 'system', path: 'C:\\Program Files (x86)' },
  // Credentials / key material
  { family: 'credentials', path: path.join(home, '.ssh') },
  { family: 'credentials', path: path.join(home, '.gnupg') },
  { family: 'credentials', path: path.join(home, '.aws') },
  { family: 'credentials', path: path.join(home, '.kube') },
  { family: 'credentials', path: path.join(home, 'Library', 'Keychains') },
  // Application data roots (broad — cover app state + nested browser profiles
  // + Lingua's own userData on macOS / Windows in one entry each)
  { family: 'app-data', path: path.join(home, 'Library', 'Application Support') },
  { family: 'app-data', path: path.join(home, 'Library', 'Safari') },
  { family: 'app-data', path: path.join(home, 'Library', 'Containers') },
  { family: 'app-data', path: path.join(home, 'AppData', 'Roaming') },
  // Browser profiles NOT covered by the broad app-data roots above:
  // Windows Chromium-family lives under %LOCALAPPDATA% (AppData\Local), and
  // Linux profiles live under ~/.config (which is too broad to block wholesale).
  { family: 'browser-profile', path: path.join(home, 'AppData', 'Local', 'Google', 'Chrome') },
  { family: 'browser-profile', path: path.join(home, 'AppData', 'Local', 'Chromium') },
  { family: 'browser-profile', path: path.join(home, 'AppData', 'Local', 'Microsoft', 'Edge') },
  { family: 'browser-profile', path: path.join(home, 'AppData', 'Local', 'BraveSoftware') },
  { family: 'browser-profile', path: path.join(home, '.config', 'google-chrome') },
  { family: 'browser-profile', path: path.join(home, '.config', 'chromium') },
  { family: 'browser-profile', path: path.join(home, '.config', 'microsoft-edge') },
  { family: 'browser-profile', path: path.join(home, '.config', 'BraveSoftware') },
  { family: 'browser-profile', path: path.join(home, '.mozilla') },
];

/**
 * Runtime-registered blocked paths. Lingua's own `userData` / `sessionData` /
 * `logs` directories are registered here at main startup via
 * `registerBlockedPaths` — resolving them from electron's `app` rather than
 * guessing the app-name path keeps this module electron-free and unit-testable.
 */
let additionalBlockedPaths: BlockedPathEntry[] = [];

/**
 * Register extra blocked paths at runtime (idempotent per exact path). Main
 * calls this once at startup with the electron-owned data dirs. Default family
 * is `lingua-data` since that is the only current caller.
 */
export function registerBlockedPaths(
  paths: readonly string[],
  family: BlockedPathFamily = 'lingua-data'
): void {
  for (const candidate of paths) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue;
    if (additionalBlockedPaths.some((entry) => entry.path === candidate)) continue;
    additionalBlockedPaths.push({ family, path: candidate });
  }
}

/** Test-only: drop all runtime-registered blocked paths between cases. */
export function resetRegisteredBlockedPaths(): void {
  additionalBlockedPaths = [];
}

/**
 * Strip Windows device-namespace and UNC prefixes so a caller passing
 * `\\?\C:\Windows\System32` or `\\.\C:\Windows` cannot side-step a block
 * entry written as `C:\Windows`. Path comparisons on these prefixed
 * forms have a different leading segment than the bare drive path, so
 * `startsWith` would return false even for an obviously protected
 * target.
 */
function stripWindowsDevicePrefix(value: string): string {
  // Matches \\?\, \\.\, //?/, //./
  const match = /^[\\/]{2}[?.][\\/]/.exec(value);
  return match ? value.slice(match[0].length) : value;
}

function canonicalizePath(value: string): string {
  const stripped = isWindows ? stripWindowsDevicePrefix(value) : value;
  const resolved = path.normalize(path.resolve(stripped));
  // Windows paths are case-insensitive on the filesystem; comparing
  // case-sensitively lets `c:\windows` slip past a `C:\Windows` block.
  return isWindows ? resolved.toLowerCase() : resolved;
}

function entryMatchesTarget(target: string, entryPath: string): boolean {
  const blocked = canonicalizePath(entryPath);
  return target === blocked || target.startsWith(blocked + path.sep);
}

/**
 * Return the matching blocked entry for `filePath`, or null. Matching is
 * lexical (canonicalize + segment-prefix). Symlink-escape is intentionally NOT
 * handled here: the capability chokepoint `resolveCapabilityPath`
 * (`src/main/ipc/projectCapabilities.ts`) already `realpath`-resolves every
 * routed operation and re-applies both the denylist and the containment check
 * against the resolved path. Re-resolving here would also over-block — on macOS
 * `os.tmpdir()` lives under `/var/folders`, and `/var` firmlinks into the
 * blocked `/private`, so a `realpath` pass would wrongly block every temp path.
 */
function matchBlockedEntry(filePath: string): BlockedPathEntry | null {
  const target = canonicalizePath(filePath);
  for (const entry of [...STATIC_BLOCKED_PATHS, ...additionalBlockedPaths]) {
    if (entryMatchesTarget(target, entry.path)) return entry;
  }
  return null;
}

/**
 * Returns true if the given path is blocked for the given operation.
 * All operations (read, write, delete) are checked against the denylist.
 */
export function isPathBlocked(
  filePath: string,
  _operation: 'read' | 'write' | 'delete'
): boolean {
  return matchBlockedEntry(filePath) !== null;
}

/**
 * Returns the family of the blocked path, or null when the path is allowed.
 * Lets callers surface an actionable, localized denial and a privacy-safe
 * telemetry signal that names only the family, never the path.
 */
export function blockedPathFamily(filePath: string): BlockedPathFamily | null {
  return matchBlockedEntry(filePath)?.family ?? null;
}

/**
 * Returns true if the given file path is within the project root.
 * Used to enforce the per-project sandbox when desired.
 */
export function isPathWithinProject(
  filePath: string,
  projectRoot: string
): boolean {
  const normalizedFile = canonicalizePath(filePath);
  const normalizedRoot = canonicalizePath(projectRoot);
  return (
    normalizedFile === normalizedRoot ||
    normalizedFile.startsWith(normalizedRoot + path.sep)
  );
}

export function isSafeEntryName(name: string): boolean {
  const trimmed = name.trim();

  if (!trimmed || trimmed === '.' || trimmed === '..') {
    return false;
  }

  if (path.basename(trimmed) !== trimmed) {
    return false;
  }

  return !trimmed.includes('\0') && !/[\\/]/.test(trimmed);
}
