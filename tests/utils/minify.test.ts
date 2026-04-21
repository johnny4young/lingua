import { describe, expect, it } from 'vitest';
import { minifySource } from '@/utils/minify';

describe('minifySource (json)', () => {
  it('compacts well-formed JSON', () => {
    const result = minifySource('json', '{\n  "a": 1,\n  "b": [2, 3]\n}\n');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('{"a":1,"b":[2,3]}');
  });

  it('is a no-op on an empty string', () => {
    const result = minifySource('json', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('');
  });

  it('returns a parse-error result for invalid JSON', () => {
    const result = minifySource('json', '{ not: "json" }');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('parse-error');
  });

  it('round-trips beautify → minify → same minified output for fixture set', () => {
    const fixtures = [
      '{"a":1}',
      '{"users":[{"name":"a"},{"name":"b"}],"count":2}',
      '[]',
      '{}',
      '{"n":0,"b":true,"s":"hello","a":[1,2,3],"o":{"k":"v"}}',
    ];
    for (const fixture of fixtures) {
      const parsed = JSON.parse(fixture) as unknown;
      const beautified = JSON.stringify(parsed, null, 2);
      const reMinified = minifySource('json', beautified);
      expect(reMinified.ok).toBe(true);
      if (reMinified.ok) {
        expect(reMinified.output).toBe(fixture);
      }
    }
  });
});

describe('minifySource (javascript)', () => {
  it('strips single- and multi-line comments', () => {
    const result = minifySource(
      'javascript',
      '// comment\nconst x = 1; /* block */ const y = 2;\n'
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('const x=1;const y=2;');
  });

  it('preserves whitespace inside string literals exactly', () => {
    const source = 'const s = "a  b\\tc";';
    const result = minifySource('javascript', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('const s="a  b\\tc";');
  });

  it('preserves template literals verbatim', () => {
    const source = 'const t = `line 1\n  line 2`;';
    const result = minifySource('javascript', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('const t=`line 1\n  line 2`;');
  });

  it('collapses whitespace only between identifiers/keywords', () => {
    const result = minifySource('javascript', 'if (a ===  b) {\n  return 1;\n}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('if(a===b){return 1;}');
  });

  it('keeps a space between two identifiers (return 1)', () => {
    const result = minifySource('javascript', 'function f() {\n  return   42;\n}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('function f(){return 42;}');
  });

  it('drops a // inside a string literal correctly (no false comment)', () => {
    const source = 'const url = "https://example.com/";';
    const result = minifySource('javascript', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('const url="https://example.com/";');
  });

  it('preserves regex literals that contain // so they are not mistaken for comments', () => {
    const source = 'const re = /https?:\\/\\/[a-z]+/gi;';
    const result = minifySource('javascript', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('const re=/https?:\\/\\/[a-z]+/gi;');
  });

  it('keeps regex literals after return-like keywords intact', () => {
    const source = 'function hasFoo(value) {\n  return /foo/.test(value);\n}';
    const result = minifySource('javascript', source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('function hasFoo(value){return/foo/.test(value);}');
  });

  it('handles an empty JS source', () => {
    const result = minifySource('javascript', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output).toBe('');
  });
});
