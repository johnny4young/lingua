import { describe, expect, it } from 'vitest';
import { joinAbsolute, parentDirOf } from '../../src/renderer/utils/filePath';

describe('renderer filePath helpers', () => {
  it('joins POSIX display paths without duplicating the root slash', () => {
    expect(joinAbsolute('/', 'hello.ts')).toBe('/hello.ts');
    expect(joinAbsolute('/project', 'src/main.ts')).toBe('/project/src/main.ts');
  });

  it('normalizes relative separators to the root separator for Windows display paths', () => {
    expect(joinAbsolute('C:\\Users\\dev\\project', 'src/main.ts')).toBe(
      'C:\\Users\\dev\\project\\src\\main.ts'
    );
  });

  it('splits Windows file paths into parent and basename', () => {
    expect(parentDirOf('C:\\Users\\dev\\project\\src\\main.ts')).toEqual({
      parent: 'C:\\Users\\dev\\project\\src',
      basename: 'main.ts',
    });
  });
});
