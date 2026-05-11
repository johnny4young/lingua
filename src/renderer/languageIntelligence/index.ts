import { createPythonLanguageIntelligenceAdapter } from './python';
import type { LanguageIntelligenceAdapter, LanguageIntelligenceResult } from './types';

export type {
  LanguageIntelligenceAdapter,
  LanguageIntelligenceCompletion,
  LanguageIntelligenceDiagnostic,
  LanguageIntelligenceResult,
  LanguageIntelligenceSeverity,
} from './types';

const adapters = new Map<string, LanguageIntelligenceAdapter>([
  ['python', createPythonLanguageIntelligenceAdapter()],
]);

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
