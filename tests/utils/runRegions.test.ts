import { describe, expect, it } from 'vitest';
import { isMaskedPrompt, mergeRegionStdin, parseRunRegions, resultComment, runRegionAt, runRegionSource, supportsRunRegions } from '../../src/renderer/utils/runRegions';

const js = [
  'function quickSort(a) { return a; }',
  '// %% sort',
  'const sorted = quickSort([3, 1]);',
  '// %% bench · slow',
  'const t = 1;',
  '// %%',
  'const name = "x";',
].join('\n');

describe('run regions', () => {
  it('splits JavaScript at top-level markers, with code above the first marker as its own region', () => {
    expect(parseRunRegions(js, 'javascript')).toEqual([
      { index: 0, name: null, markerLine: null, startLine: 1, endLine: 1 },
      { index: 1, name: 'sort', markerLine: 2, startLine: 2, endLine: 3 },
      { index: 2, name: 'bench', markerLine: 4, startLine: 4, endLine: 5 },
      { index: 3, name: null, markerLine: 6, startLine: 6, endLine: 7 },
    ]);
  });

  it('ignores markers inside strings, templates, blocks and after code', () => {
    const code = ['const s = `', '// %% not', '`;', 'function f() {', '  // %% inner', '}', 'x(); // %% tail', "const q = '// %% str';"].join('\n');
    expect(parseRunRegions(code, 'typescript')).toEqual([]);
  });

  it('skips blank lines above the first marker', () => {
    expect(parseRunRegions('\n\n// %% a\nlet x = 1;', 'javascript')).toEqual([
      { index: 0, name: 'a', markerLine: 3, startLine: 3, endLine: 4 },
    ]);
  });

  it('splits Python at column-0 markers outside triple-quoted strings', () => {
    const py = ['import math', '# %% load', 'x = 1', 'doc = """', '# %% inside', '"""', '  # %% indented', '#%% compact', 'print(x)'].join('\n');
    expect(parseRunRegions(py, 'python')).toEqual([
      { index: 0, name: null, markerLine: null, startLine: 1, endLine: 1 },
      { index: 1, name: 'load', markerLine: 2, startLine: 2, endLine: 7 },
      { index: 2, name: 'compact', markerLine: 8, startLine: 8, endLine: 9 },
    ]);
  });

  it('finds the region at a line and runs everything up to its end', () => {
    const regions = parseRunRegions(js, 'javascript');
    expect(runRegionAt(regions, 5)?.name).toBe('bench');
    expect(runRegionAt(regions, 99)).toBeNull();
    expect(runRegionSource(js, regions[2]!).split('\n')).toHaveLength(5);
    expect(runRegionSource(js, regions[2]!).endsWith('const t = 1;')).toBe(true);
  });

  it('writes a one-line arrow comment only where the line ends in code', () => {
    expect(resultComment('javascript', 'doubled.length', 1, '3')).toBe(' // => 3');
    expect(resultComment('python', 'base * 2', 1, '[1,\n 2]')).toBe('  # => [1, 2]');
    expect(resultComment('javascript', 'x // note', 1, '3')).toBeNull();
    expect(resultComment('javascript', 'const s = `a\nb`', 1, '3')).toBeNull();
    expect(resultComment('javascript', 'f(1,\n2)', 1, '3')).toBeNull();
    expect(resultComment('python', 'x  # note', 1, '3')).toBeNull();
    expect(resultComment('python', 'f"""Status: {s}\nBody"""', 1, "'Status: {__import__(1)}'")).toBeNull();
    expect(resultComment('python', 'doc = """\nx = 1\n"""', 2, '1')).toBeNull();
    expect(resultComment('python', 'total = 1 + \\\n  2', 1, '3')).toBeNull();
    expect(resultComment('python', 'print(1,\n  2)', 1, '3')).toBeNull();
    expect(resultComment('python', "label = 'a # b'", 1, '3')).toBe('  # => 3');
    expect(resultComment('python', "label = 'it", 1, '3')).toBeNull();
    expect(resultComment('python', 'x = """a"""\nx', 2, "'a'")).toBe("  # => 'a'");
    expect(resultComment('javascript', '   ', 1, '3')).toBeNull();
    expect(resultComment('javascript', 'x', 1, '  ')).toBeNull();
    expect(resultComment('javascript', 'x', 1, 'v'.repeat(100))).toHaveLength(' // => '.length + 60);
    expect(resultComment('javascript', 'x', 1, '"\u202eab\u2066c\u200bd\u0000"')).toBe(' // => " ab c d "');
    expect(resultComment('javascript', 'x', 1, '😀'.repeat(80))).toBe(` // => ${'😀'.repeat(59)}…`);
    expect(resultComment('javascript', 'x; /* note\nmore */', 1, '3')).toBeNull();
  });

  it('masks prompts that ask for secrets', () => {
    for (const prompt of ['Password:', 'Tu contraseña', 'API token', 'Client secret', 'PIN code']) expect(isMaskedPrompt(prompt)).toBe(true);
    for (const prompt of ['Your name?', 'Spin count', 'Pinned tab']) expect(isMaskedPrompt(prompt)).toBe(false);
  });

  it('puts masked answers back at their place in the stdin stream', () => {
    expect(mergeRegionStdin('Ada\nLondon\n', [{ index: 1, value: 'hunter2' }])).toBe('Ada\nhunter2\nLondon');
    expect(mergeRegionStdin('', [{ index: 0, value: 's' }])).toBe('s');
    expect(mergeRegionStdin('a', [{ index: 9, value: 's' }, { index: 0, value: 'p' }])).toBe('p\na\ns');
    expect(mergeRegionStdin('a\nb', [{ index: 2, value: 'y' }, { index: 0, value: 'x' }])).toBe('x\na\ny\nb');
    expect(mergeRegionStdin('', [])).toBeUndefined();
    expect(mergeRegionStdin('a\n')).toBe('a');
  });

  it('caps long names and supports only JS, TS and Python', () => {
    expect(parseRunRegions(`// %% ${'n'.repeat(80)}\n1`, 'javascript')[0]!.name).toHaveLength(40);
    expect(supportsRunRegions('python')).toBe(true);
    expect(supportsRunRegions('go')).toBe(false);
  });
});
