import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { lookupRoot, resolveCapabilityPath } from '../ipc/projectCapabilities';
import {
  asRelativePath,
  asRootId,
  type RootId,
  type RelativePath,
} from '../../shared/fs/brandedIds';

/** Reuses the capability chokepoint; a server URI cannot mint or broaden a grant. */
export async function resolveLspNavigationTarget(
  rootId: RootId,
  uri: unknown
): Promise<RelativePath | null> {
  if (typeof rootId !== 'string' || typeof uri !== 'string' || uri.length > 8192) return null;
  const root = lookupRoot(asRootId(rootId));
  if (!root) return null;
  let absolute: string;
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:' || url.hostname || url.search || url.hash) return null;
    absolute = fileURLToPath(url);
  } catch {
    return null;
  }
  const relative = await relativeToRoot(root.rootPath, absolute);
  if (relative === null) return null;
  const resolved = await resolveCapabilityPath(rootId, relative, 'read');
  if (!resolved.ok) return null;
  if (!(await stat(resolved.absolutePath).catch(() => null))?.isFile()) return null;
  // A revoked grant after async resolution cannot return an approved destination.
  const fresh = await resolveCapabilityPath(rootId, relative, 'read');
  return fresh.ok && fresh.absolutePath === resolved.absolutePath ? asRelativePath(relative) : null;
}

// Servers start on the root's realpath, so destinations may arrive through it.
async function relativeToRoot(rootPath: string, absolute: string): Promise<string | null> {
  for (const base of [rootPath, await realpath(rootPath).catch(() => rootPath)]) {
    const relative = path.relative(base, absolute);
    if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      return relative.replaceAll(path.sep, '/');
  }
  return null;
}
