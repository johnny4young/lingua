import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import {
  BUILT_IN_TEMPLATES,
  getTemplatesForLanguage,
  resolveTemplateDescription,
  resolveTemplateFileStem,
  resolveTemplateLabel,
} from '@/data/templates';

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

  it('should have stable translation keys per template', () => {
    for (const tpl of BUILT_IN_TEMPLATES) {
      expect(tpl.fileStem.length).toBeGreaterThan(0);
      expect(tpl.labelKey).toBe(`templates.${tpl.id}.label`);
      expect(tpl.descriptionKey).toBe(`templates.${tpl.id}.description`);
    }
  });

  it('should filter templates by language', () => {
    const jsTpls = getTemplatesForLanguage('javascript');
    expect(jsTpls.every((t) => t.language === 'javascript')).toBe(true);

    const rustTpls = getTemplatesForLanguage('rust');
    expect(rustTpls.every((t) => t.language === 'rust')).toBe(true);
  });

  it('resolves labels and descriptions through i18next', async () => {
    const hello = BUILT_IN_TEMPLATES.find((tpl) => tpl.id === 'js-hello');
    expect(hello).toBeDefined();
    if (!hello) return;

    const t = i18next.t.bind(i18next);
    await i18next.changeLanguage('en');
    expect(resolveTemplateLabel(hello, t)).toBe('Hello World');
    expect(resolveTemplateDescription(hello, t)).toBe('Print a greeting to the console');

    await i18next.changeLanguage('es');
    expect(resolveTemplateLabel(hello, t)).toBe('Hola mundo');
    expect(resolveTemplateDescription(hello, t)).toBe('Imprime un saludo en la consola');
    await i18next.changeLanguage('en');
  });

  it('falls back safely when no translator is provided', () => {
    const [first] = BUILT_IN_TEMPLATES;
    expect(resolveTemplateFileStem(first)).toBe(first.fileStem);
    expect(resolveTemplateLabel(first)).toBe(first.fileStem);
    expect(resolveTemplateDescription(first)).toBe('');
  });
});
