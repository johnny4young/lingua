import { describe, expect, it } from 'vitest';
import { IGNORED_PATH_PREFIXES, isIgnoredPath } from '#src/shared/fs/ignoredPaths';

describe('IGNORED_PATH_PREFIXES', () => {
  it('declares a non-empty set with each entry ending in a slash', () => {
    expect(IGNORED_PATH_PREFIXES.length).toBeGreaterThan(0);
    for (const prefix of IGNORED_PATH_PREFIXES) {
      expect(prefix.endsWith('/'), `prefix ${prefix} must end in a slash`).toBe(true);
    }
  });

  it('covers the canonical buildtool / framework / tooling-cache directories', () => {
    expect(IGNORED_PATH_PREFIXES).toContain('node_modules/');
    expect(IGNORED_PATH_PREFIXES).toContain('.git/');
    expect(IGNORED_PATH_PREFIXES).toContain('dist/');
    expect(IGNORED_PATH_PREFIXES).toContain('out/');
    expect(IGNORED_PATH_PREFIXES).toContain('__pycache__/');
  });
});

describe('isIgnoredPath', () => {
  it('returns false for the empty path (project root)', () => {
    expect(isIgnoredPath('')).toBe(false);
  });

  it('returns true for an exact bare directory name', () => {
    expect(isIgnoredPath('node_modules')).toBe(true);
    expect(isIgnoredPath('.git')).toBe(true);
    expect(isIgnoredPath('dist')).toBe(true);
  });

  it('returns true for descendants of an ignored directory', () => {
    expect(isIgnoredPath('node_modules/foo')).toBe(true);
    expect(isIgnoredPath('node_modules/foo/bar.js')).toBe(true);
    expect(isIgnoredPath('.git/HEAD')).toBe(true);
    expect(isIgnoredPath('.vite/cache/abc')).toBe(true);
    expect(isIgnoredPath('__pycache__/foo.cpython-310.pyc')).toBe(true);
  });

  it('returns false for source-tree paths', () => {
    expect(isIgnoredPath('src/foo.ts')).toBe(false);
    expect(isIgnoredPath('package.json')).toBe(false);
    expect(isIgnoredPath('README.md')).toBe(false);
    expect(isIgnoredPath('lib/utils.ts')).toBe(false);
    expect(isIgnoredPath('app/main.py')).toBe(false);
  });

  it('does NOT match siblings that share a prefix substring', () => {
    // `node_modules_backup` shares the prefix `node_modules` but is
    // not in the ignored list. The trailing-slash convention prevents
    // false positives.
    expect(isIgnoredPath('node_modules_backup')).toBe(false);
    expect(isIgnoredPath('node_modules_backup/foo')).toBe(false);
    expect(isIgnoredPath('disturbance.txt')).toBe(false);
    expect(isIgnoredPath('outline.md')).toBe(false);
    expect(isIgnoredPath('build_log.txt')).toBe(false);
  });

  it('normalizes Windows backslash separators', () => {
    expect(isIgnoredPath('node_modules\\foo')).toBe(true);
    expect(isIgnoredPath('.git\\HEAD')).toBe(true);
    expect(isIgnoredPath('src\\foo.ts')).toBe(false);
  });

  it('handles deeply nested paths', () => {
    expect(isIgnoredPath('node_modules/@scope/pkg/dist/index.js')).toBe(true);
    expect(isIgnoredPath('app/dist/foo.js')).toBe(false);
    // RL-087 honest call: the slice ignores top-level `dist/` only,
    // not nested `dist/` directories deeper in the tree. A nested
    // build artefact still triggers a re-index. Future ticket can
    // extend if it becomes a real problem.
  });
});
