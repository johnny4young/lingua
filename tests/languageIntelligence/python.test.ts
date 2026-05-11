import i18next from 'i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import en from '../../src/renderer/i18n/locales/en/common.json';
import es from '../../src/renderer/i18n/locales/es/common.json';
import { analyzePythonLanguageIntelligence } from '../../src/renderer/languageIntelligence/python';

describe('Python language intelligence adapter', () => {
  beforeEach(async () => {
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: { common: en },
        es: { common: es },
      },
      defaultNS: 'common',
      interpolation: { escapeValue: false },
    });
  });

  it('reports Python block and delimiter diagnostics with localized messages', async () => {
    const result = analyzePythonLanguageIntelligence(
      ['def broken()', '    values = [1, 2, 3', '    print(values))'].join('\n')
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: 1,
          message: 'Python block statements need a trailing colon.',
          severity: 'error',
        }),
        expect.objectContaining({
          line: 3,
          message: 'Unexpected closing delimiter ")".',
          severity: 'error',
        }),
        expect.objectContaining({
          line: 2,
          message: 'Unclosed delimiter "[".',
          severity: 'error',
        }),
      ])
    );

    await i18next.changeLanguage('es');
    expect(analyzePythonLanguageIntelligence('if ready\n    pass').diagnostics[0]).toMatchObject({
      message: 'Las sentencias de bloque de Python necesitan dos puntos al final.',
    });
  });

  it('ignores strings and comments while collecting symbols and diagnostics', () => {
    const result = analyzePythonLanguageIntelligence(
      [
        'text = "def fake()"',
        '# class Hidden:',
        'from math import sqrt as root',
        'import pathlib, os as operating_system',
        '',
        'class ReportWriter:',
        '    pass',
        '',
        'def write_report(items: list[str]):',
        '    total = len(items)',
        '    for item in items:',
        '        print(item)',
      ].join('\n')
    );

    expect(result.diagnostics).toHaveLength(0);
    expect(result.completions.map((completion) => completion.label)).toEqual(
      expect.arrayContaining([
        'text',
        'root',
        'pathlib',
        'operating_system',
        'ReportWriter',
        'write_report',
        'items',
        'total',
        'item',
      ])
    );
    expect(result.completions.find((completion) => completion.label === 'fake')).toBeUndefined();
    expect(result.completions.find((completion) => completion.label === 'Hidden')).toBeUndefined();
    expect(result.completions.find((completion) => completion.label === 'list')).toBeUndefined();
    expect(result.completions.find((completion) => completion.label === 'str')).toBeUndefined();
  });

  it('does not mark an intentionally multiline block header before delimiters close', () => {
    const result = analyzePythonLanguageIntelligence(
      ['def build_total(', '    amount,', '    tax', '):', '    return amount + tax'].join('\n')
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it('accepts inline suites with a top-level colon', () => {
    const result = analyzePythonLanguageIntelligence(
      ['def f(): return 1', 'if ready: run()', 'for item in items: print(item)'].join('\n')
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it('reports missing colons after multiline headers close', () => {
    const result = analyzePythonLanguageIntelligence(
      ['def build_total(', '    amount,', '    tax', ')', '    return amount + tax'].join('\n')
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: 1,
          message: 'Python block statements need a trailing colon.',
          severity: 'error',
        }),
      ])
    );
  });
});
