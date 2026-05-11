import i18next from 'i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import en from '../../src/renderer/i18n/locales/en/common.json';
import es from '../../src/renderer/i18n/locales/es/common.json';
import {
  providePythonHover,
  providePythonSignatureHelp,
} from '../../src/renderer/languageIntelligence/python';

const SAMPLE = [
  'import pathlib',
  'from math import sqrt as root',
  '',
  'class InvoiceBuilder:',
  '    pass',
  '',
  'def compute_total(amount, tax: int = 0):',
  '    subtotal = amount',
  '    return subtotal + tax',
].join('\n');

describe('Python hover provider', () => {
  beforeEach(async () => {
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { common: en }, es: { common: es } },
      defaultNS: 'common',
      interpolation: { escapeValue: false },
    });
  });

  it('resolves a function name to its kind, definition line, and signature', () => {
    // `compute_total` is on line 7, column 5..18 in the SAMPLE source.
    const hover = providePythonHover(SAMPLE, 7, 10);
    expect(hover).toMatchObject({
      symbol: 'compute_total',
      kind: 'function',
      definedAtLine: 7,
      secondary: '(amount, tax: int = 0)',
    });
  });

  it('resolves a class definition to a class hover with no secondary detail', () => {
    const hover = providePythonHover(SAMPLE, 4, 9);
    expect(hover).toMatchObject({
      symbol: 'InvoiceBuilder',
      kind: 'class',
      definedAtLine: 4,
    });
    expect(hover?.secondary).toBeUndefined();
  });

  it('resolves an imported alias to a module hover', () => {
    const hover = providePythonHover(SAMPLE, 2, 27);
    expect(hover).toMatchObject({ symbol: 'root', kind: 'module', definedAtLine: 2 });
  });

  it('returns null when the cursor is on a Python keyword', () => {
    expect(providePythonHover(SAMPLE, 7, 2)).toBeNull();
  });

  it('returns null when the cursor is on a symbol the file never defined', () => {
    const content = ['x = mystery()', ''].join('\n');
    expect(providePythonHover(content, 1, 8)).toBeNull();
  });

  it('does not treat annotation identifiers as local variables', () => {
    expect(providePythonHover(SAMPLE, 7, 33)).toBeNull();
  });

  it('returns null for cursors inside strings or comments', () => {
    const content = [
      'note = "compute_total is a fake reference"',
      '# compute_total in this comment is also hidden',
    ].join('\n');
    expect(providePythonHover(content, 1, 12)).toBeNull();
    expect(providePythonHover(content, 2, 8)).toBeNull();
  });

  it('returns null when the position is out of range', () => {
    expect(providePythonHover(SAMPLE, 999, 1)).toBeNull();
  });
});

describe('Python signature help provider', () => {
  beforeEach(async () => {
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { common: en }, es: { common: es } },
      defaultNS: 'common',
      interpolation: { escapeValue: false },
    });
  });

  it('returns the parameter list with activeParameter=0 immediately after the open paren', () => {
    const content = [SAMPLE, '', 'compute_total('].join('\n');
    // Last line is index 11 (1-based), column 15 sits right after `(`.
    const help = providePythonSignatureHelp(content, 11, 15);
    expect(help).toMatchObject({
      symbol: 'compute_total',
      activeParameter: 0,
    });
    expect(help?.parameters.map(param => param.label)).toEqual(['amount', 'tax: int = 0']);
  });

  it('advances activeParameter as the cursor crosses top-level commas', () => {
    const content = [SAMPLE, '', 'compute_total(1, 2'].join('\n');
    // Column 19 sits past the second argument.
    const help = providePythonSignatureHelp(content, 11, 19);
    expect(help?.activeParameter).toBe(1);
  });

  it('resolves the innermost enclosing call inside a nested expression', () => {
    const content = [SAMPLE, '', 'compute_total(compute_total(1, 2)'].join('\n');
    // Cursor between `1, ` and `2` — inside the nested call.
    const help = providePythonSignatureHelp(content, 11, 32);
    expect(help?.symbol).toBe('compute_total');
    expect(help?.activeParameter).toBe(1);
  });

  it('keeps the outer call active while the cursor is inside a nested literal argument', () => {
    const content = [SAMPLE, '', 'compute_total([1, 2'].join('\n');
    const help = providePythonSignatureHelp(content, 11, 20);
    expect(help?.symbol).toBe('compute_total');
    expect(help?.activeParameter).toBe(0);
  });

  it('does not surface signature help while defining a function', () => {
    const content = [SAMPLE, '', 'def local_helper('].join('\n');
    expect(providePythonSignatureHelp(content, 11, 18)).toBeNull();
  });

  it('returns null when the call target is not a known local function', () => {
    const content = [SAMPLE, '', 'print(1, 2'].join('\n');
    expect(providePythonSignatureHelp(content, 11, 11)).toBeNull();
  });

  it('returns null when the cursor sits inside a string or comment', () => {
    const content = [SAMPLE, '', '# compute_total('].join('\n');
    expect(providePythonSignatureHelp(content, 11, 17)).toBeNull();
  });

  it('supports multi-line call sites by walking lines backwards', () => {
    const content = [SAMPLE, '', 'compute_total(', '    1,', '    2'].join('\n');
    const help = providePythonSignatureHelp(content, 13, 6);
    expect(help?.symbol).toBe('compute_total');
    expect(help?.activeParameter).toBe(1);
  });

  it('uses parameters from multi-line function definitions', () => {
    const content = [
      'def build_total(',
      '    amount,',
      '    tax: int = 0',
      '):',
      '    return amount + tax',
      '',
      'build_total(1, ',
    ].join('\n');
    const help = providePythonSignatureHelp(content, 7, 16);
    expect(help?.parameters.map(param => param.label)).toEqual(['amount', 'tax: int = 0']);
    expect(help?.activeParameter).toBe(1);
  });

  it('localizes nothing of its own — providers handle copy at render time', () => {
    // The renderer-side providers fetch translations via `i18next.t()` at
    // render time, so this analyzer returns raw shapes. Locking the
    // language-agnostic shape lets future renderers (or the next runtime
    // adapter) plug in without translation drift.
    const content = [SAMPLE, '', 'compute_total(1'].join('\n');
    const help = providePythonSignatureHelp(content, 11, 16);
    expect(help).toEqual({
      symbol: 'compute_total',
      parameters: [{ label: 'amount' }, { label: 'tax: int = 0' }],
      activeParameter: 0,
    });
  });
});
