/**
 * internal — Capability-based filesystem IPC sandbox.
 *
 * The renderer used to hand main absolute filesystem paths and trust
 * that a denylist (`isPathBlocked`) caught the dangerous ones. A
 * compromised renderer (XSS in some render path, a contaminated npm
 * dep, a future plugin surface) could pass any non-denylisted path
 * and main would happily read or write it. The model has flipped to
 * positive authorization:
 *
 *   1. The user picks a project root through a system dialog.
 *   2. Main mints an opaque `rootId` token bound to the canonicalized
 *      absolute path of that root.
 *   3. Every subsequent filesystem call from the renderer carries
 *      `{ rootId, relativePath }`. Main resolves the relative path
 *      against the root, runs `realpath` to defeat symlink-out
 *      attacks, and verifies the resolved target is contained in the
 *      approved root before any disk I/O.
 *   4. Unknown rootIds, traversal escapes, Windows device-prefix
 *      injections, denylist hits on the resolved path, and unsafe
 *      basename components all fail before the underlying syscall.
 *
 * The existing `permissions.ts` helpers (`isPathWithinProject`,
 * `isPathBlocked`, `isSafeEntryName`) are reused as the path-shape
 * primitives; this module owns the token lifecycle and the unified
 * `resolveCapabilityPath` chokepoint every IPC handler routes through.
 *
 * The registry is process-lifetime in-memory only. Tokens do not
 * persist across app restarts; a separate `fs:reopen-root` IPC
 * re-mints a token for an absolute path the user previously approved
 * (the persisted `currentProject.rootPath` in the project store), so
 * the user does not have to re-pick on every relaunch.
 */

import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isPathBlocked, isPathWithinProject, isSafeEntryName } from './permissions';
import {
  asRelativePath,
  asRootId,
  type RelativePath,
  type RootId,
  type WatchId,
} from '../../shared/fs/brandedIds';

/**
 * implementation detail — the capability ids are branded `string` types so a
 * `WatchId` or a `RelativePath` can never be swapped in where a `RootId`
 * is expected (and vice versa). The brands are compile-time only and
 * erase to `string` over the IPC wire; the canonical definitions + cast
 * helpers live in `src/shared/fs/brandedIds.ts` so the renderer can reach
 * them through the ambient `LinguaAPI` alias without importing from main.
 * Re-exported here because the mint/lookup helpers below hand out branded
 * tokens and the audit calls for the brand surface to be visible from
 * this module.
 *
 * `RootId` is an opaque, unguessable token; the renderer treats it as a
 * black box and only main can interpret it.
 */
export type { RelativePath, RootId, WatchId };

interface CapabilityEntry {
  /** Canonical absolute path of the approved root. */
  rootPath: string;
  /** `realpath`-resolved root path, cached after first lookup. */
  realRootPath: string;
  /**
   * Optional single-file grant. Project roots leave this unset; file
   * pickers bind the capability to exactly one relative path so a
   * compromised renderer cannot reuse a picked-file grant for siblings.
   */
  allowedRelativePath?: string;
}

const REGISTRY = new Map<RootId, CapabilityEntry>();

/**
 * Resolve every layer of symlinks then canonicalize the result. Cached
 * per rootId to avoid hitting `realpath` on every call. Falls back to
 * the canonical path if `realpath` fails — that path is still the one
 * the user explicitly approved, so it is safe to use as the
 * containment anchor; the failure usually means the directory was
 * removed underneath us, in which case downstream syscalls will fail
 * loudly anyway.
 */
async function getRealRootPath(entry: CapabilityEntry): Promise<string> {
  if (entry.realRootPath) return entry.realRootPath;
  try {
    const resolved = await realpath(entry.rootPath);
    entry.realRootPath = path.normalize(resolved);
  } catch {
    entry.realRootPath = entry.rootPath;
  }
  return entry.realRootPath;
}

/**
 * Mint a capability token for the given absolute path. The path is
 * canonicalized but NOT validated against the denylist here — the
 * caller (typically the picker handler) has already shown the user a
 * native dialog and the user explicitly approved the root, so a
 * picker-time denylist hit must be enforced where the dialog returns,
 * not here.
 */
export function mintRootCapability(absoluteRootPath: string): {
  rootId: RootId;
  rootPath: string;
} {
  const rootPath = path.normalize(path.resolve(absoluteRootPath));
  const rootId = asRootId(randomUUID());
  REGISTRY.set(rootId, { rootPath, realRootPath: '' });
  return { rootId, rootPath };
}

/**
 * Mint a single-file capability. The root is the file's parent
 * directory, but `resolveCapabilityPath` will only authorize the exact
 * basename this function records.
 */
export function mintFileCapability(absoluteFilePath: string): {
  rootId: RootId;
  rootPath: string;
  fileRelativePath: RelativePath;
} {
  const absolutePath = path.normalize(path.resolve(absoluteFilePath));
  const rootPath = path.dirname(absolutePath);
  const fileRelativePath = asRelativePath(path.basename(absolutePath));
  const rootId = asRootId(randomUUID());
  REGISTRY.set(rootId, {
    rootPath,
    realRootPath: '',
    allowedRelativePath: fileRelativePath,
  });
  return { rootId, rootPath, fileRelativePath };
}

/** Returns the canonical root path for a known token, or `null`. */
export function lookupRoot(rootId: RootId): { rootPath: string } | null {
  const entry = REGISTRY.get(rootId);
  return entry ? { rootPath: entry.rootPath } : null;
}

/** Idempotent revoke — removes the token from the registry. */
export function revokeRoot(rootId: RootId): boolean {
  return REGISTRY.delete(rootId);
}

/** Test-only escape hatch for clearing the registry between cases. */
export function clearRegistryForTests(): void {
  REGISTRY.clear();
}

/**
 * The single chokepoint every filesystem IPC handler routes through.
 * Returns the resolved absolute path on success, or a tagged error so
 * the caller can map it to a stable IPC error shape.
 *
 * Steps:
 *   1. Look up the rootId. Unknown → `unknown-root`.
 *   2. Reject literal traversal patterns in the supplied relative
 *      path (`..` segments, absolute path inputs, Windows device
 *      prefixes). These are caught BEFORE resolve so the caller fails
 *      loudly on intent rather than silently absorbing into the
 *      `escapes-root` branch.
 *   3. Resolve the relative path against the approved root and
 *      canonicalize.
 *   4. Verify containment in the approved root (`isPathWithinProject`).
 *   5. Run `realpath` and verify containment again — defeats symlinks
 *      that point outside the root after resolution.
 *
 * The empty string relative path resolves to the root itself, which
 * is a legitimate case for `listAllFiles`, `readdir`, `stat`, and
 * watcher subscription.
 */
export type CapabilityResolution =
  | { ok: true; absolutePath: string; rootPath: string }
  | {
      ok: false;
      error: 'unknown-root' | 'escapes-root' | 'unsafe-path' | 'blocked-path';
    };

const WINDOWS_DEVICE_PREFIX = /^[\\/]{2}[?.][\\/]/;
type FilesystemOperation = 'read' | 'write' | 'delete';

function looksLikeAbsolutePath(value: string): boolean {
  if (value.length === 0) return false;
  if (path.isAbsolute(value)) return true;
  // Windows-specific: `C:foo` (drive-relative) or `C:\foo`.
  if (/^[a-zA-Z]:/.test(value)) return true;
  return false;
}

function containsUnsafeSegment(relativePath: string): boolean {
  if (relativePath.length === 0) return false;
  if (WINDOWS_DEVICE_PREFIX.test(relativePath)) return true;
  // Split on both separators so a Unix-style relative path containing
  // a back-slash on Windows is still scanned.
  const segments = relativePath.split(/[\\/]/);
  return segments
    .filter((segment) => segment.length > 0)
    .some((segment) => segment === '..' || !isSafeEntryName(segment));
}

async function resolveRealCandidate(
  entry: CapabilityEntry,
  candidate: string
): Promise<string> {
  try {
    return path.normalize(await realpath(candidate));
  } catch {
    // Walk up to the nearest existing ancestor.
    let probe = path.dirname(candidate);
    while (isPathWithinProject(probe, entry.rootPath)) {
      try {
        const realProbe = path.normalize(await realpath(probe));
        // Reattach the never-existed leaf path. The leaf's name has
        // already been validated as a non-traversal segment above, so
        // appending it cannot reintroduce an escape.
        return path.join(realProbe, path.relative(probe, candidate));
      } catch {
        if (probe === entry.rootPath) break;
        const nextProbe = path.dirname(probe);
        if (nextProbe === probe) break;
        probe = nextProbe;
      }
    }

    // No ancestor existed beyond the approved root, or the approved
    // root itself could not be realpathed. Anchor the non-existent
    // target to the real root when possible so symlinked project roots
    // can still create new files inside their approved target.
    const realRoot = await getRealRootPath(entry);
    return path.join(realRoot, path.relative(entry.rootPath, candidate));
  }
}

export async function resolveCapabilityPath(
  rootId: unknown,
  relativePath: unknown,
  operation: FilesystemOperation = 'read'
): Promise<CapabilityResolution> {
  if (typeof rootId !== 'string' || rootId.length === 0) {
    return { ok: false, error: 'unknown-root' };
  }
  // Boundary cast: this chokepoint accepts an untrusted `unknown` and the
  // registry lookup IS the validation (an unrecognized token resolves to
  // `unknown-root` below). Branding the narrowed string here is the
  // sanctioned mint point for a `RootId` derived from raw IPC input.
  const entry = REGISTRY.get(asRootId(rootId));
  if (!entry) return { ok: false, error: 'unknown-root' };

  if (typeof relativePath !== 'string') {
    return { ok: false, error: 'unsafe-path' };
  }

  const rel = relativePath;
  if (looksLikeAbsolutePath(rel)) {
    return { ok: false, error: 'unsafe-path' };
  }
  if (containsUnsafeSegment(rel)) {
    return { ok: false, error: 'unsafe-path' };
  }

  const normalizedRel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (
    entry.allowedRelativePath !== undefined &&
    normalizedRel !== entry.allowedRelativePath
  ) {
    return { ok: false, error: 'unsafe-path' };
  }

  const candidate = path.normalize(path.resolve(entry.rootPath, rel));

  if (!isPathWithinProject(candidate, entry.rootPath)) {
    return { ok: false, error: 'escapes-root' };
  }

  if (isPathBlocked(candidate, operation)) {
    return { ok: false, error: 'blocked-path' };
  }

  // Symlink-out check: realpath the candidate (if it exists) and
  // verify containment against the realpath of the root. If the
  // candidate does not exist yet (e.g. a write target inside a real
  // directory), only the directory's realpath matters; we walk up
  // until we find an existing ancestor and check that one.
  const realCandidate = await resolveRealCandidate(entry, candidate);
  const realRoot = await getRealRootPath(entry);
  if (!isPathWithinProject(realCandidate, realRoot)) {
    return { ok: false, error: 'escapes-root' };
  }
  if (isPathBlocked(realCandidate, operation)) {
    return { ok: false, error: 'blocked-path' };
  }

  return { ok: true, absolutePath: realCandidate, rootPath: entry.rootPath };
}
