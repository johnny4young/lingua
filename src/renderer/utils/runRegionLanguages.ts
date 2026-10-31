export type RunRegionLanguage = 'javascript' | 'typescript' | 'python';

/** Kept apart from the parser so the Run shortcut can check it without loading the comment lexer. */
export function supportsRunRegions(language: string): language is RunRegionLanguage {
  return language === 'javascript' || language === 'typescript' || language === 'python';
}
