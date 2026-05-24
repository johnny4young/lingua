// SPDX-License-Identifier: MIT
/**
 * RL-103 Slice 1 — Schema validator unit tests for
 * `parseProjectTemplate`. Covers the four reject paths explicitly
 * (path traversal, duplicate relPath, entry-file-not-in-files,
 * invalid language) plus a positive baseline so the happy path is
 * locked alongside the negative cases.
 */

import { describe, expect, it } from 'vitest';
import {
  parseProjectTemplate,
  projectTemplateDirname,
} from '../../src/shared/projectTemplate';

function makeBase(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'fixture-template',
    labelKey: 'fixture.label',
    descriptionKey: 'fixture.description',
    language: 'javascript',
    entryFile: 'src/index.js',
    files: [
      { relPath: 'src/index.js', content: 'console.log(1)\n' },
      { relPath: 'package.json', content: '{}\n' },
    ],
    license: 'MIT',
  };
}

describe('parseProjectTemplate', () => {
  it('accepts a well-formed template literal', () => {
    const result = parseProjectTemplate(makeBase());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.template.id).toBe('fixture-template');
      expect(result.template.language).toBe('javascript');
      expect(result.template.files).toHaveLength(2);
    }
  });

  it('rejects path traversal segments', () => {
    const bad = makeBase();
    bad.files = [
      { relPath: '../escape.js', content: '// boom' },
      { relPath: 'package.json', content: '{}' },
    ];
    bad.entryFile = 'package.json';
    expect(parseProjectTemplate(bad)).toEqual({
      ok: false,
      reason: 'invalid-rel-path',
    });
  });

  it('rejects absolute-style paths', () => {
    const bad = makeBase();
    bad.files = [
      { relPath: '/etc/passwd', content: '' },
      { relPath: 'package.json', content: '{}' },
    ];
    bad.entryFile = 'package.json';
    expect(parseProjectTemplate(bad)).toEqual({
      ok: false,
      reason: 'invalid-rel-path',
    });
  });

  it('rejects duplicate relPath entries', () => {
    const bad = makeBase();
    bad.files = [
      { relPath: 'src/index.js', content: 'a' },
      { relPath: 'src/index.js', content: 'b' },
    ];
    expect(parseProjectTemplate(bad)).toEqual({
      ok: false,
      reason: 'duplicate-rel-path',
    });
  });

  it('rejects when entryFile is not in files[]', () => {
    const bad = makeBase();
    bad.entryFile = 'src/missing.js';
    expect(parseProjectTemplate(bad)).toEqual({
      ok: false,
      reason: 'entry-file-not-in-files',
    });
  });

  it('rejects an unknown language pack id', () => {
    const bad = makeBase();
    bad.language = 'cobol';
    expect(parseProjectTemplate(bad)).toEqual({
      ok: false,
      reason: 'invalid-language',
    });
  });

  it('allows empty file content', () => {
    const empty = makeBase();
    empty.files = [
      { relPath: 'src/index.js', content: '' },
      { relPath: '.gitignore', content: '' },
    ];
    empty.entryFile = 'src/index.js';
    const result = parseProjectTemplate(empty);
    expect(result.ok).toBe(true);
  });

  it('strips unknown optional fields without breaking', () => {
    const extra = makeBase();
    // Schema does not declare a "tags" field; the validator returns
    // a normalized object that drops anything off-contract so the
    // renderer never reads a property the closed schema does not
    // know about.
    (extra as Record<string, unknown>).tags = ['rest', 'api'];
    const result = parseProjectTemplate(extra);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('tags' in result.template).toBe(false);
    }
  });

  it('rejects when files is empty', () => {
    const bad = makeBase();
    bad.files = [];
    expect(parseProjectTemplate(bad)).toEqual({
      ok: false,
      reason: 'no-files',
    });
  });
});

describe('projectTemplateDirname', () => {
  it('returns empty for top-level files', () => {
    expect(projectTemplateDirname('package.json')).toBe('');
  });

  it('returns the parent for nested files', () => {
    expect(projectTemplateDirname('src/index.js')).toBe('src');
  });

  it('returns nested intermediate dirs', () => {
    expect(projectTemplateDirname('a/b/c/d.txt')).toBe('a/b/c');
  });
});
