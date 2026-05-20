import i18next from 'i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import en from '../../src/renderer/i18n/locales/en/common.json';
import es from '../../src/renderer/i18n/locales/es/common.json';
import {
  analyzeRubyLanguageIntelligence,
  provideRubyHover,
  provideRubySignatureHelp,
} from '../../src/renderer/languageIntelligence/ruby';

const SAMPLE = [
  'class InvoiceBuilder',
  '  def compute_total(amount, tax: 0)',
  '    subtotal = amount',
  '    subtotal + tax',
  '  end',
  'end',
].join('\n');

describe('Ruby language intelligence adapter', () => {
  beforeEach(async () => {
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { common: en }, es: { common: es } },
      defaultNS: 'common',
      interpolation: { escapeValue: false },
    });
  });

  it('collects Ruby classes, methods, parameters, locals, and block variables', () => {
    const result = analyzeRubyLanguageIntelligence(
      [
        'class ReportWriter',
        '  def render(items, prefix: nil)',
        '    total = items.length',
        '    items.each do |item, index|',
        '      puts item',
        '    end',
        '  end',
        'end',
      ].join('\n')
    );

    expect(result.diagnostics).toHaveLength(0);
    expect(result.completions.map(completion => completion.label)).toEqual(
      expect.arrayContaining([
        'ReportWriter',
        'render',
        'items',
        'prefix',
        'total',
        'item',
        'index',
      ])
    );
    expect(result.completions.find(completion => completion.label === 'render')).toMatchObject({
      kind: 'function',
      detail: 'Method defined in this file',
    });
  });

  it('reports unmatched delimiters and block end issues with localized messages', async () => {
    const result = analyzeRubyLanguageIntelligence(
      ['end', 'def broken(value', '  puts(value]'].join('\n')
    );

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: 1,
          message: 'Unexpected Ruby end.',
          severity: 'error',
        }),
        expect.objectContaining({
          line: 3,
          message: 'Unexpected closing delimiter "]".',
          severity: 'error',
        }),
        expect.objectContaining({
          line: 2,
          message: 'Unclosed delimiter "(".',
          severity: 'error',
        }),
        expect.objectContaining({
          line: 2,
          message: 'Ruby block "def" needs a matching end.',
          severity: 'error',
        }),
      ])
    );

    await i18next.changeLanguage('es');
    expect(analyzeRubyLanguageIntelligence('class Broken').diagnostics[0]).toMatchObject({
      message: 'El bloque Ruby "class" necesita un end correspondiente.',
    });
  });

  it('ignores symbols inside Ruby strings and comments', () => {
    const result = analyzeRubyLanguageIntelligence(
      ['text = "def fake(value)"', '# class Hidden', 'visible = 1'].join('\n')
    );

    expect(result.completions.map(completion => completion.label)).toEqual(
      expect.arrayContaining(['text', 'visible'])
    );
    expect(result.completions.find(completion => completion.label === 'fake')).toBeUndefined();
    expect(result.completions.find(completion => completion.label === 'Hidden')).toBeUndefined();
  });

  it('resolves Ruby hover information for local methods and classes', () => {
    expect(provideRubyHover(SAMPLE, 2, 9)).toMatchObject({
      symbol: 'compute_total',
      kind: 'function',
      definedAtLine: 2,
      secondary: '(amount, tax: 0)',
    });
    expect(provideRubyHover(SAMPLE, 1, 9)).toMatchObject({
      symbol: 'InvoiceBuilder',
      kind: 'class',
      definedAtLine: 1,
    });
    expect(provideRubyHover(SAMPLE, 2, 2)).toBeNull();
  });

  it('returns Ruby signature help for local method calls', () => {
    const content = [SAMPLE, '', 'compute_total(1, '].join('\n');
    const help = provideRubySignatureHelp(content, 8, 17);

    expect(help).toEqual({
      symbol: 'compute_total',
      parameters: [{ label: 'amount' }, { label: 'tax: 0' }],
      activeParameter: 1,
    });
  });
});
