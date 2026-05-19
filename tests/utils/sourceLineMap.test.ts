import MagicString from 'magic-string';
import { describe, expect, it } from 'vitest';
import { buildGeneratedSourceLineMap } from '@/utils/sourceLineMap';

describe('buildGeneratedSourceLineMap', () => {
  it('maps generated lines back to original source lines', () => {
    const source = ['const text = "hix2";', 'console.log(text);'].join('\n');
    const ms = new MagicString(source);
    ms.prepend('// generated helper\n');

    const generated = ms.toString();
    const map = ms
      .generateMap({
        source: 'scratchpad.ts',
        includeContent: true,
        hires: true,
      })
      .toString();

    const lineMap = buildGeneratedSourceLineMap(generated, map);

    expect(lineMap[2]).toBe(1);
    expect(lineMap[3]).toBe(2);
  });

  it('returns an empty map for missing or malformed maps', () => {
    expect(buildGeneratedSourceLineMap('console.log(1)', undefined)).toEqual({});
    expect(buildGeneratedSourceLineMap('console.log(1)', 'not-json')).toEqual({});
  });
});
