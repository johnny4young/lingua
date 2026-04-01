import { describe, it, expect } from 'vitest';
import { BUILT_IN_TEMPLATES, getTemplatesForLanguage } from '@/data/templates';

describe('templates', () => {
  it('should have templates for all 5 languages', () => {
    const languages = ['javascript', 'typescript', 'go', 'python', 'rust'] as const;
    for (const lang of languages) {
      const tpls = getTemplatesForLanguage(lang);
      expect(tpls.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('should have unique IDs', () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have non-empty code for every template', () => {
    for (const tpl of BUILT_IN_TEMPLATES) {
      expect(tpl.code.trim().length).toBeGreaterThan(0);
    }
  });

  it('should filter templates by language', () => {
    const jsTpls = getTemplatesForLanguage('javascript');
    expect(jsTpls.every((t) => t.language === 'javascript')).toBe(true);

    const rustTpls = getTemplatesForLanguage('rust');
    expect(rustTpls.every((t) => t.language === 'rust')).toBe(true);
  });
});
