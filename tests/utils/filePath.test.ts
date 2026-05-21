import { describe, expect, it } from 'vitest';
import {
  joinAbsolute,
  parentDirOf,
  pathToFileUri,
  rustLspModelPathForTab,
  smartTruncatePath,
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

describe('smartTruncatePath (RL-024 Slice 1 fold E)', () => {
  it('collapses the home prefix to ~ when it matches', () => {
    expect(
      smartTruncatePath('/Users/alice/projects/foo', {
        homePrefix: '/Users/alice',
      })
    ).toBe('~/projects/foo');
  });

  it('returns the path unchanged when the home prefix does not match', () => {
    expect(
      smartTruncatePath('/var/log/messages', { homePrefix: '/Users/alice' })
    ).toBe('/var/log/messages');
  });

  it('returns the path unchanged when no home prefix is supplied', () => {
    expect(smartTruncatePath('/Users/alice/project')).toBe(
      '/Users/alice/project'
    );
  });

  it('elides the middle when the path is longer than maxLength', () => {
    const long =
      '/Users/alice/deeply/nested/inside/the/codebase/project-name';
    const out = smartTruncatePath(long, {
      homePrefix: '/Users/alice',
      maxLength: 24,
    });
    expect(out).toContain('~');
    expect(out).toContain('…');
    expect(out).toContain('project-name');
    // The penultimate segment survives so the user keeps two real
    // anchors at the tail end.
    expect(out).toContain('codebase');
  });

  it('keeps short paths untouched even when the home prefix is present', () => {
    expect(
      smartTruncatePath('/Users/alice/proj', {
        homePrefix: '/Users/alice',
        maxLength: 48,
      })
    ).toBe('~/proj');
  });

  it('handles trailing slashes in the home prefix gracefully', () => {
    expect(
      smartTruncatePath('/Users/alice/projects/foo', {
        homePrefix: '/Users/alice/',
      })
    ).toBe('~/projects/foo');
  });

  it('normalises Windows separators when matching the home prefix', () => {
    expect(
      smartTruncatePath('C:\\Users\\alice\\proj', {
        homePrefix: 'C:\\Users\\alice',
      })
    ).toBe('~/proj');
  });

  it('elides a long Windows path after the home collapse', () => {
    const long =
      'C:\\Users\\alice\\very\\deeply\\nested\\inside\\the\\codebase\\project-name';
    const out = smartTruncatePath(long, {
      homePrefix: 'C:\\Users\\alice',
      maxLength: 32,
    });
    // After collapse the post-home portion uses POSIX separators
    // (`smartTruncatePath` rebuilds with `/` once the home prefix
    // matches). Ellipsis still keeps the leading `~` + the two tail
    // segments.
    expect(out).toContain('~');
    expect(out).toContain('…');
    expect(out).toContain('codebase');
    expect(out).toContain('project-name');
  });
});
