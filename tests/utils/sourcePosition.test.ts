import MagicString from 'magic-string';
import { describe, expect, it } from 'vitest';
import { createSourcePositionMapper } from '../../src/shared/sourcePosition';

describe('source position maps', () => {
  it('composes line and column shifts without copying source content', () => {
    const source = new MagicString('throw Error("test")');
    source.prepend('// helper\n');
    const first = source.generateMap({ source: 'input', hires: true }).toString();
    const next = new MagicString(source.toString());
    next.appendLeft('// helper\n'.length, '__tick(); ');
    const second = next.generateMap({ source: 'input', hires: true }).toString();
    const map = createSourcePositionMapper([second, first], 1);
    expect(map({ line: 2, column: 16 })).toEqual({ line: 1, column: 6 });
    expect(first).not.toContain('sourcesContent');
  });

  it('keeps malformed maps and unmapped generated helpers unknown', () => {
    expect(createSourcePositionMapper(['not-json'])({ line: 1, column: 1 })).toBeNull();
    const source = new MagicString('x');
    source.prepend('// helper\n');
    const map = createSourcePositionMapper([source.generateMap({ source: 'input', hires: true }).toString()]);
    expect(map({ line: 1, column: 1 })).toBeNull();
    expect(createSourcePositionMapper([], 1)({ line: 2, column: 1 })).toBeNull();
    expect(createSourcePositionMapper([])({ line: 1, column: 0 })).toBeNull();
  });
});
