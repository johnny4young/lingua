/**
 * Dependency adapter registry and lazy loader.
 *
 * Language eligibility stays synchronous so callers can immediately evict
 * unsupported tabs. Detector implementations stay behind dynamic imports:
 * this registry only requests Acorn after a debounced JS/TS buffer may contain
 * a package reference, and the Python scanner follows the same boundary.
 */

import type { DependencyAdapter, DependencyAdapterLanguage } from './types';

const ADAPTER_LOADERS: Record<DependencyAdapterLanguage, () => Promise<DependencyAdapter>> = {
  javascript: async () => (await import('./javascriptDetector')).javascriptDependencyAdapter,
  typescript: async () => (await import('./javascriptDetector')).typescriptDependencyAdapter,
  python: async () => (await import('./pythonDetector')).pythonDependencyAdapter,
};

export const DEPENDENCY_ADAPTER_LANGUAGES: readonly DependencyAdapterLanguage[] =
  Object.freeze(Object.keys(ADAPTER_LOADERS) as DependencyAdapterLanguage[]);

const ADAPTER_LANGUAGE_SET = new Set<string>(DEPENDENCY_ADAPTER_LANGUAGES);

const adapterPromises = new Map<DependencyAdapterLanguage, Promise<DependencyAdapter>>();

export function isDependencyAdapterLanguage(
  language: string
): language is DependencyAdapterLanguage {
  return ADAPTER_LANGUAGE_SET.has(language);
}

/**
 * Conservative synchronous preflight. False means the detector would return
 * no package references, so normal scratchpads avoid fetching a parser solely
 * to confirm an empty result. False positives only load the deferred chunk;
 * the language detector remains authoritative.
 */
export function sourceMayReferenceDependencies(
  language: DependencyAdapterLanguage,
  source: string
): boolean {
  if (source.length === 0) return false;
  if (language === 'python') {
    return /^\s*(?:from|import)\b/mu.test(source);
  }
  return /\b(?:export|import|require)\b/u.test(source);
}

/**
 * Return one shared in-flight/resolved adapter promise per language. A failed
 * load is evicted so a later edit can retry instead of pinning a rejection for
 * the rest of the session.
 */
export function loadDependencyAdapter(
  language: DependencyAdapterLanguage
): Promise<DependencyAdapter> {
  const existing = adapterPromises.get(language);
  if (existing) return existing;

  const pending = ADAPTER_LOADERS[language]();
  adapterPromises.set(language, pending);
  void pending.catch(() => {
    if (adapterPromises.get(language) === pending) {
      adapterPromises.delete(language);
    }
  });
  return pending;
}

export async function maybeLoadDependencyAdapter(
  language: string | null | undefined
): Promise<DependencyAdapter | null> {
  if (!language) return null;
  if (!isDependencyAdapterLanguage(language)) return null;
  return loadDependencyAdapter(language);
}

export type { DependencyAdapter, DependencyAdapterLanguage };
