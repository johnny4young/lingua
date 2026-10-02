import { describe, expect, it } from 'vitest';
import { URI } from 'monaco-editor/esm/vs/base/common/uri.js';
import {
  joinAbsolute,
  lspModelPathForTab,
  parentDirOf,
  pathToFileUri,
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
      lspModelPathForTab({
        id: 'tab-1',
        name: 'main.rs',
        language: 'rust',
        filePath: '/Users/alice/Mi proyecto/src/main.rs',
      })
    ).toBe('file:///Users/alice/Mi%20proyecto/src/main.rs');
  });

  it('creates a stable file URI for unsaved Rust tabs', () => {
    expect(
      lspModelPathForTab({
        id: 'tab 1',
        name: 'scratch',
        language: 'rust',
      })
    ).toBe('file:///__lingua_unsaved__/tab%201/scratch.rs');
  });

  it('escapes URL delimiters in file URI path segments', () => {
    expect(pathToFileUri('/tmp/a#b?c.rs')).toBe('file:///tmp/a%23b%3Fc.rs');
  });

  it.each([
    '/Users/a/proj(1)/main.go',
    '/x/@scope/a+b/main.rs',
    "/x/it's [draft]!*/a,b;c=d&e$f/main.go",
    '/Users/alice/Mi proyecto 🦀/ñ/100%.rs',
    'C:\\Users\\dev\\proj\\main.go',
  ])('matches the Monaco model URI for %s', absolutePath => {
    const uri = pathToFileUri(absolutePath);
    expect(URI.parse(uri).toString()).toBe(uri);
    const model = lspModelPathForTab({
      id: 'x',
      name: 'n',
      language: 'go',
      filePath: absolutePath,
    });
    expect(URI.parse(model!).toString()).toBe(model);
  });

  it('keeps unsaved model paths canonical and ignores non-LSP languages', () => {
    const unsaved = lspModelPathForTab({ id: 'tab(1)', name: 'a/b', language: 'go' })!;
    expect(unsaved).toBe('file:///__lingua_unsaved__/tab%281%29/a/b.go');
    expect(URI.parse(unsaved).toString()).toBe(unsaved);
    expect(lspModelPathForTab({ id: 'x', name: 'a.py', language: 'python' })).toBeUndefined();
  });
});

describe('smartTruncatePath', () => {
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
