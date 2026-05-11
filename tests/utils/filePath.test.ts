import { describe, expect, it } from 'vitest';
import {
  joinAbsolute,
  parentDirOf,
  pathToFileUri,
  rustLspModelPathForTab,
} from '../../src/renderer/utils/filePath';

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

  it('encodes saved Rust paths as file URIs for rust-analyzer', () => {
    expect(
      rustLspModelPathForTab({
        id: 'tab-1',
        name: 'main.rs',
        filePath: '/Users/alice/Mi proyecto/src/main.rs',
      })
    ).toBe('file:///Users/alice/Mi%20proyecto/src/main.rs');
  });

  it('creates a stable file URI for unsaved Rust tabs', () => {
    expect(
      rustLspModelPathForTab({
        id: 'tab 1',
        name: 'scratch',
      })
    ).toBe('file:///__lingua_unsaved__/tab%201/scratch.rs');
  });

  it('escapes URL delimiters in file URI path segments', () => {
    expect(pathToFileUri('/tmp/a#b?c.rs')).toBe('file:///tmp/a%23b%3Fc.rs');
  });
});
