import { getLanguageSupportDescriptors } from '../languageSupport/registry';
import type { LanguageIntelligenceAdapter, LanguageIntelligenceResult } from './types';

export type {
  LanguageIntelligenceAdapter,
  LanguageIntelligenceCompletion,
  LanguageIntelligenceDiagnostic,
  LanguageIntelligenceResult,
  LanguageIntelligenceSeverity,
} from './types';

const adapters = new Map<string, LanguageIntelligenceAdapter>(
  getLanguageSupportDescriptors()
    .filter((descriptor) => descriptor.createLanguageIntelligenceAdapter)
    .map((descriptor) => [
      descriptor.id,
      descriptor.createLanguageIntelligenceAdapter?.(),
    ])
    .filter(
      (entry): entry is [string, LanguageIntelligenceAdapter] => entry[1] !== undefined
    )
);

export function getLanguageIntelligenceAdapter(
  language: string | null | undefined
): LanguageIntelligenceAdapter | null {
  if (!language) return null;
  return adapters.get(language) ?? null;
}

export function analyzeLanguageIntelligence(
  language: string,
  content: string
): LanguageIntelligenceResult | null {
  return getLanguageIntelligenceAdapter(language)?.analyze(content) ?? null;
}
