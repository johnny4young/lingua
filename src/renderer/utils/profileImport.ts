/**
 * internal — apply a parsed LinguaProfile to the live renderer stores
 * under one of three policies:
 *
 *   - `replace`: overwrite existing data wholesale.
 *   - `merge`: list-shaped data is concatenated (snippets get id
 *     collision rebinding; env-var keys are written with imported
 *     winning on collision); singletons (settings) imported wins.
 *   - `preserve`: imported loses on every collision; only fills what
 *     is empty.
 *
 * Settings are singletons, so `merge` collapses to `replace` for them.
 * The policy hint copy in the UI surfaces this so users know the
 * difference is only meaningful for snippets and env vars.
 *
 * Snippet Free-tier ceiling is grandfathered on import: the existing
 * `addSnippet` gate would refuse the 26th snippet on a Free account,
 * which would silently drop user data. Instead we write the snippets
 * directly via `setState`, mirroring internal's grandfather rule for
 * already-saved snippets above the cap.
 */

import type {
  LinguaProfile,
  PortableSettings,
  PortableSnippet,
  PortableEnvVars,
  ProfileImportPolicy,
} from '../../shared/profile/profile';
import { sanitizeScope } from '../../shared/envVarScopes';
import { useEnvVarsStore } from '../stores/envVarsStore';
import { sanitizeShortcutOverrides, useSettingsStore } from '../stores/settingsStore';
import { useSnippetsStore } from '../stores/snippetsStore';
import type { Snippet } from '../stores/snippetsStore';

export interface ImportSummary {
  settingsKeysApplied: number;
  snippetsAdded: number;
  snippetsReplaced: number;
  envVarsApplied: number;
}

function applySettings(
  imported: PortableSettings,
  policy: ProfileImportPolicy
): number {
  const current = useSettingsStore.getState() as unknown as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  let applied = 0;
  for (const [key, value] of Object.entries(imported)) {
    if (value === undefined) continue;
    if (policy === 'preserve') {
      const existing = current[key];
      if (existing !== undefined && existing !== null && existing !== '' && !(typeof existing === 'object' && existing !== null && !Array.isArray(existing) && Object.keys(existing as object).length === 0)) {
        // Honour `preserve`: skip when current already holds a value.
        continue;
      }
    }
    next[key] = value;
    applied += 1;
  }
  // internal — the persist-middleware merge would normally sanitize
  // shortcutOverrides on rehydrate. The import path goes around
  // persist (writes through setState directly), so a crafted profile
  // could otherwise install unknown shortcut ids or oversized token
  // arrays for the rest of the session. Re-run the sanitizer here.
  if ('shortcutOverrides' in next) {
    next.shortcutOverrides = sanitizeShortcutOverrides(next.shortcutOverrides);
  }
  if (applied === 0) return 0;
  useSettingsStore.setState(
    next as unknown as Parameters<typeof useSettingsStore.setState>[0]
  );
  return applied;
}

function rebindSnippetId(id: string, taken: ReadonlySet<string>): string {
  if (!taken.has(id)) return id;
  let candidate = `${id}-imported-1`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${id}-imported-${n}`;
    n += 1;
  }
  return candidate;
}

function toSnippet(portable: PortableSnippet, id = portable.id): Snippet {
  return {
    id,
    language: portable.language as Snippet['language'],
    label: portable.label,
    description: portable.description,
    code: portable.code,
    createdAt: portable.createdAt,
  };
}

interface SnippetMergeResult {
  next: Snippet[];
  added: number;
  replaced: number;
}

function applySnippets(
  imported: PortableSnippet[],
  policy: ProfileImportPolicy
): SnippetMergeResult {
  const current = useSnippetsStore.getState().snippets;

  if (policy === 'replace') {
    const next = imported.map((s) => toSnippet(s));
    useSnippetsStore.setState({ snippets: next });
    return { next, added: next.length, replaced: current.length };
  }

  if (policy === 'merge') {
    const taken = new Set(current.map((s) => s.id));
    const additions: Snippet[] = [];
    for (const portable of imported) {
      const id = rebindSnippetId(portable.id, taken);
      taken.add(id);
      additions.push(toSnippet(portable, id));
    }
    const next = [...current, ...additions];
    useSnippetsStore.setState({ snippets: next });
    return { next, added: additions.length, replaced: 0 };
  }

  // preserve — only add snippets whose label doesn't already exist.
  const existingLabels = new Set(current.map((s) => s.label));
  const additions: Snippet[] = [];
  const taken = new Set(current.map((s) => s.id));
  for (const portable of imported) {
    if (existingLabels.has(portable.label)) continue;
    const id = rebindSnippetId(portable.id, taken);
    taken.add(id);
    additions.push(toSnippet(portable, id));
  }
  const next = [...current, ...additions];
  useSnippetsStore.setState({ snippets: next });
  return { next, added: additions.length, replaced: 0 };
}

function mergeStringMap(
  current: Record<string, string>,
  imported: Record<string, string>,
  policy: ProfileImportPolicy
): Record<string, string> {
  if (policy === 'replace') return { ...imported };
  if (policy === 'merge') return { ...current, ...imported };
  // preserve — only fill keys absent from current
  const next = { ...current };
  for (const [key, value] of Object.entries(imported)) {
    if (!(key in next)) next[key] = value;
  }
  return next;
}

function applyEnvVars(
  imported: PortableEnvVars,
  policy: ProfileImportPolicy
): number {
  const current = useEnvVarsStore.getState();
  const importedGlobal = sanitizeScope(imported.global);
  const nextGlobal = mergeStringMap(current.global, importedGlobal, policy);

  const projectKeys = new Set([
    ...Object.keys(current.project),
    ...Object.keys(imported.project),
  ]);
  const nextProject: Record<string, Record<string, string>> = {};
  for (const projectId of projectKeys) {
    const currentScope = current.project[projectId] ?? {};
    const importedScope = sanitizeScope(imported.project[projectId] ?? {});
    const merged = mergeStringMap(currentScope, importedScope, policy);
    if (Object.keys(merged).length > 0) {
      nextProject[projectId] = merged;
    }
  }

  // For replace, drop project scopes that are not in the imported set.
  if (policy === 'replace') {
    for (const projectId of Object.keys(nextProject)) {
      if (!(projectId in imported.project)) delete nextProject[projectId];
    }
  }

  useEnvVarsStore.setState({ global: nextGlobal, project: nextProject });

  return (
    Object.keys(nextGlobal).length +
    Object.values(nextProject).reduce((sum, scope) => sum + Object.keys(scope).length, 0)
  );
}

/**
 * Apply the parsed profile to the live stores. Returns a summary
 * with the count of fields touched per domain so the UI can confirm
 * what changed.
 */
export function applyProfile(
  profile: LinguaProfile,
  policy: ProfileImportPolicy
): ImportSummary {
  const settingsKeysApplied = applySettings(profile.data.settings, policy);
  const { added, replaced } = applySnippets(profile.data.snippets, policy);
  const envVarsApplied = applyEnvVars(profile.data.envVars, policy);
  return {
    settingsKeysApplied,
    snippetsAdded: added,
    snippetsReplaced: replaced,
    envVarsApplied,
  };
}
