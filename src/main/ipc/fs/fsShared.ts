import {
  resolveCapabilityPath,
  type CapabilityResolution,
} from '../projectCapabilities';

/**
 * internal — pure helpers shared by the filesystem IPC handler groups
 * (`fsSearchReplace`, `fsBundle`, and the core `fileSystem` assembly).
 * Extracted VERBATIM from `fileSystem.ts` so the god-file could be split
 * along handler-group lines without changing any behavior. Nothing here
 * touches mutable module state; the watcher/approval state stays in
 * `fileSystem.ts`.
 */

export const HIDDEN_ENTRIES = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'target', // Rust build output
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

/**
 * implementation — OS metadata files the bundle-import empty-dir guard
 * treats as non-blocking, mirroring `useProjectTemplateScaffolder`'s
 * `EMPTY_DIR_IGNORE`. Refusing to import into a folder that holds only
 * `.DS_Store` / `Thumbs.db` / a custom-icon marker would be a hostile
 * false positive.
 */
export const EMPTY_DIR_IGNORE = new Set<string>([
  '.DS_Store',
  '.localized',
  'Icon\r',
  '.AppleDouble',
  'Thumbs.db',
  'desktop.ini',
]);

export function shouldHide(name: string): boolean {
  if (HIDDEN_ENTRIES.has(name)) return true;
  // Hide all dotfiles except a few useful ones
  if (name.startsWith('.') && name !== '.env' && name !== '.gitignore') {
    return true;
  }
  return false;
}

export function joinRelative(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/$/, '');
}

/**
 * Compute the parent of a relative path using only `/` separators.
 * Renderer-supplied relative paths can mix `\` and `/` (Windows
 * persistence rehydrating on POSIX, etc.); using `path.dirname` here
 * would honor the host OS separator and break those mixed strings.
 */
export function dirnameRelative(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function coerceBundleBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

export function coercePositiveLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(1, Math.floor(value)));
}

export class CapabilityError extends Error {
  constructor(
    public readonly code: NonNullable<Extract<CapabilityResolution, { ok: false }>>['error']
  ) {
    super(`Filesystem capability error: ${code}`);
  }
}

export async function resolveOrThrow(
  rootId: unknown,
  relativePath: unknown,
  operation: 'read' | 'write' | 'delete'
): Promise<{ absolutePath: string; rootPath: string }> {
  const resolution = await resolveCapabilityPath(rootId, relativePath, operation);
  if (!resolution.ok) {
    throw new CapabilityError(resolution.error);
  }
  return { absolutePath: resolution.absolutePath, rootPath: resolution.rootPath };
}
