/**
 * RL-025 Slice A - main-side JS / TS dependency resolver.
 *
 * Pure existence check against the active tab's resolved cwd
 * (`resolveNodeCwd` re-uses the Node-runner walker). Slice B will
 * add an install path on top of this contract; Slice A is read-only
 * so a malformed specifier or a non-existent cwd is a soft no-op
 * (the renderer falls back to `'detected'`).
 *
 * Specifier safety: the caller's renderer already validated
 * specifiers via the shared detector (no `.`, no `..`, no `/`
 * absolute paths, no `node:` built-ins). Main re-validates so a
 * compromised renderer cannot probe arbitrary filesystem paths.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveNodeCwd } from './node-runner';

// Keep `-` last in each character class so it is treated as a literal
// hyphen. This shape is npm-name strict: lowercase / digits / dot /
// underscore / hyphen, with an optional `@scope/` prefix.
const SAFE_PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9_.-]*\/)?[a-z0-9][a-z0-9_.-]*$/iu;

export type DependencyResolveStatus = 'installed' | 'detected' | 'invalid';

export interface DependencyResolveResult {
  readonly statuses: Record<string, DependencyResolveStatus>;
  readonly cwd: string | null;
}

function isSafeSpecifier(specifier: unknown): specifier is string {
  if (typeof specifier !== 'string') return false;
  if (specifier.length === 0 || specifier.length > 214) return false;
  return SAFE_PACKAGE_NAME_RE.test(specifier);
}

function packageDirectoryFor(cwd: string, name: string): string {
  if (name.startsWith('@')) {
    const [scope, pkg] = name.split('/', 2);
    if (!scope || !pkg) return path.join(cwd, 'node_modules', name);
    return path.join(cwd, 'node_modules', scope, pkg);
  }
  return path.join(cwd, 'node_modules', name);
}

/**
 * Resolve a batch of npm package names against the cwd derived from
 * the active tab's `filePath`. Returns one status per requested
 * specifier in a flat record - the renderer maps the status to its
 * own `DependencyStatus` enum.
 *
 * When the caller does not pass a `filePath` (unsaved Scratchpad
 * tabs), `resolveNodeCwd` falls back to `app.getPath('temp')`.
 * Probing `<temp>/node_modules` could produce false installed rows
 * on shared CI hosts or developer machines, so unsaved tabs return
 * `detected` for every name instead.
 */
export function resolveJsDependencyBatch(
  specifiers: readonly unknown[],
  filePath?: string
): DependencyResolveResult {
  const hasFilePath = typeof filePath === 'string' && filePath.length > 0;
  const cwd = resolveNodeCwd(hasFilePath ? filePath : undefined);
  const statuses: Record<string, DependencyResolveStatus> = {};
  for (const raw of specifiers) {
    if (!isSafeSpecifier(raw)) continue;
    const name = raw;
    if (Object.prototype.hasOwnProperty.call(statuses, name)) continue;
    if (!hasFilePath) {
      statuses[name] = 'detected';
      continue;
    }
    try {
      const probe = packageDirectoryFor(cwd, name);
      // Stay inside `cwd/node_modules/...` - if the joined path
      // somehow escaped (e.g. a name with an embedded separator that
      // slipped the regex), refuse the probe.
      const nodeModulesRoot = path.join(cwd, 'node_modules');
      const relative = path.relative(nodeModulesRoot, probe);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        statuses[name] = 'invalid';
        continue;
      }
      statuses[name] = existsSync(probe) ? 'installed' : 'detected';
    } catch {
      statuses[name] = 'detected';
    }
  }
  return { statuses, cwd: hasFilePath ? cwd : null };
}
