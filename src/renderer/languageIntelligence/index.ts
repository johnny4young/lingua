import { getLanguageSupportDescriptor } from '../languageSupport/registry';
import type { LanguageIntelligenceAdapter } from './types';

export type { LanguageIntelligenceAdapter } from './types';

const adapterLoads = new Map<string, Promise<LanguageIntelligenceAdapter | null>>();

export function hasLanguageIntelligenceAdapter(
  language: string | null | undefined
): boolean {
  if (!language) return false;
  return Boolean(getLanguageSupportDescriptor(language)?.loadLanguageIntelligenceAdapter);
}

/**
 * Load one renderer-local analyzer exactly once. Failed imports are not cached
 * so a transient chunk error can recover after a later language activation.
 */
export function loadLanguageIntelligenceAdapter(
  language: string | null | undefined
): Promise<LanguageIntelligenceAdapter | null> {
  if (!language) return Promise.resolve(null);
  const cached = adapterLoads.get(language);
  if (cached) return cached;

  const loader = getLanguageSupportDescriptor(language)?.loadLanguageIntelligenceAdapter;
  if (!loader) return Promise.resolve(null);

  const load = Promise.resolve()
    .then(loader)
    .catch(() => {
      adapterLoads.delete(language);
      return null;
    });
  adapterLoads.set(language, load);
  return load;
}
