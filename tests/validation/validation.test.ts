import { describe, expect, it } from 'vitest';

import { supportsValidation, validateDocument } from '@/validation';

describe('validation', () => {
  it('validates JSON documents with source locations', () => {
    const result = validateDocument('json', '{\n  "name": "Lingua",\n}\n');

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        severity: 'error',
        source: 'json',
        line: 3,
      })
    );
  });

  it('validates YAML documents with structural error locations', () => {
    const result = validateDocument('yaml', 'services:\n  api: [\n');

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        severity: 'error',
        source: 'yaml',
        line: 3,
      })
    );
  });

  it('flags duplicate and malformed dotenv entries', () => {
    const result = validateDocument('dotenv', 'API_KEY=test\nINVALID LINE\nAPI_KEY=again\n');

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        source: 'dotenv',
        line: 2,
      }),
      expect.objectContaining({
        severity: 'warning',
        source: 'dotenv',
        line: 3,
      }),
    ]);
  });

  it('flags inconsistent CSV rows and unclosed quotes', () => {
    const result = validateDocument('csv', 'name,value\nalpha,1\nbeta\ncharlie,"oops\n');

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        source: 'csv',
        line: 3,
      }),
      expect.objectContaining({
        severity: 'error',
        source: 'csv',
        line: 4,
      }),
    ]);
  });

  it('reports which languages have explicit lint support', () => {
    expect(supportsValidation('json')).toBe(true);
    expect(supportsValidation('yaml')).toBe(true);
    expect(supportsValidation('dotenv')).toBe(true);
    expect(supportsValidation('csv')).toBe(true);
    expect(supportsValidation('editorconfig')).toBe(true);
    expect(supportsValidation('dockerfile')).toBe(true);
    expect(supportsValidation('gitignore')).toBe(true);
    expect(supportsValidation('makefile')).toBe(true);
    expect(supportsValidation('toml')).toBe(false);
  });

  it('validates EditorConfig keys and enum values', () => {
    const result = validateDocument(
      'editorconfig',
      [
        'root = true',
        '',
        '[*]',
        'indent_style = weird',
        'indent_size = tab',
        'make_me_a_coffee = yes',
        'just-a-line-without-equals',
      ].join('\n')
    );

    const sources = result.diagnostics.map((d) => d.source);
    expect(sources.every((s) => s === 'editorconfig')).toBe(true);

    expect(
      result.diagnostics.some(
        (d) => d.line === 4 && /indent_style/i.test(d.message) && d.severity === 'warning'
      )
    ).toBe(true);
    // `tab` is legal for indent_size
    expect(result.diagnostics.some((d) => d.line === 5 && d.severity === 'warning')).toBe(false);
    expect(
      result.diagnostics.some((d) => d.line === 6 && d.severity === 'info')
    ).toBe(true);
    expect(
      result.diagnostics.some((d) => d.line === 7 && d.severity === 'warning')
    ).toBe(true);
  });

  it('accepts a canonical well-formed .editorconfig without diagnostics', () => {
    const result = validateDocument(
      'editorconfig',
      'root = true\n\n[*]\nindent_style = space\nindent_size = 2\nend_of_line = lf\n'
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('flags MAINTAINER, missing FROM, and ADD <url> in Dockerfiles', () => {
    const result = validateDocument(
      'dockerfile',
      [
        '# syntax=docker/dockerfile:1',
        'MAINTAINER someone@example.com',
        'RUN echo "hi"',
        'ADD https://example.com/foo.tgz /tmp/foo.tgz',
      ].join('\n')
    );

    const messages = result.diagnostics.map((d) => d.message.toLowerCase());
    expect(messages.some((m) => m.includes('maintainer is deprecated'))).toBe(true);
    expect(messages.some((m) => m.includes('first instruction'))).toBe(true);
    expect(messages.some((m) => m.includes('add <url>') || m.includes('add does not'))).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('flags a Dockerfile with no FROM at all', () => {
    const result = validateDocument('dockerfile', 'RUN echo hi\n');
    expect(result.diagnostics.some((d) => /missing a FROM/i.test(d.message))).toBe(true);
  });

  it('still reports missing FROM when the file only contains deprecated MAINTAINER', () => {
    const result = validateDocument('dockerfile', 'MAINTAINER someone@example.com\n');
    expect(result.diagnostics.some((d) => /maintainer is deprecated/i.test(d.message))).toBe(true);
    expect(result.diagnostics.some((d) => /missing a FROM/i.test(d.message))).toBe(true);
  });

  it('accepts a minimal valid Dockerfile without diagnostics', () => {
    const result = validateDocument('dockerfile', 'FROM node:20\nWORKDIR /app\n');
    expect(result.diagnostics).toEqual([]);
  });

  it('warns on FROM :latest and on FROM without any tag', () => {
    const latest = validateDocument('dockerfile', 'FROM node:latest\n');
    expect(latest.diagnostics.some((d) => /:latest/i.test(d.message))).toBe(true);

    const untagged = validateDocument('dockerfile', 'FROM ubuntu\nCMD ["sh"]\n');
    expect(untagged.diagnostics.some((d) => /no tag/i.test(d.message))).toBe(true);
  });

  it('does not mistake a registry port for an image tag', () => {
    const result = validateDocument(
      'dockerfile',
      'FROM localhost:5000/ubuntu\nCMD ["sh"]\n'
    );
    expect(result.diagnostics.some((d) => /no tag/i.test(d.message))).toBe(true);
    expect(result.diagnostics.some((d) => /:latest/i.test(d.message))).toBe(false);
  });

  it('does not warn on FROM scratch or a pinned @sha256 digest', () => {
    const scratch = validateDocument('dockerfile', 'FROM scratch\nCMD ["/app"]\n');
    expect(scratch.diagnostics).toEqual([]);

    const digested = validateDocument(
      'dockerfile',
      'FROM node@sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789\nCMD ["node"]\n'
    );
    expect(digested.diagnostics).toEqual([]);
  });

  it('warns on RUN apt-get install without -y', () => {
    const missingY = validateDocument(
      'dockerfile',
      'FROM ubuntu:22.04\nRUN apt-get install curl\n'
    );
    expect(missingY.diagnostics.some((d) => /apt-get install without/i.test(d.message))).toBe(true);

    const hasY = validateDocument(
      'dockerfile',
      'FROM ubuntu:22.04\nRUN apt-get update && apt-get install -y curl\n'
    );
    expect(hasY.diagnostics.some((d) => /apt-get install without/i.test(d.message))).toBe(false);
  });

  it('flags suspicious .gitignore patterns without false-positives on comments', () => {
    const result = validateDocument(
      'gitignore',
      [
        '# build artefacts',
        'node_modules/',
        'dist/',
        'node_modules/', // duplicate (info)
        'src\\foo',       // backslash warning
        '!',              // empty negation
      ].join('\n')
    );

    expect(result.diagnostics.some((d) => d.line === 4 && d.severity === 'info')).toBe(true);
    expect(
      result.diagnostics.some((d) => d.line === 5 && /forward slashes/i.test(d.message))
    ).toBe(true);
    expect(result.diagnostics.some((d) => d.line === 6 && /does nothing/i.test(d.message))).toBe(true);
  });

  it('accepts a clean .gitignore without diagnostics', () => {
    const result = validateDocument('gitignore', 'node_modules/\ndist/\n.env\n!.env.example\n');
    expect(result.diagnostics).toEqual([]);
  });

  it('flags space-indented Makefile recipes as errors', () => {
    const result = validateDocument(
      'makefile',
      ['all:', '    echo "Hello"', ''].join('\n')
    );
    expect(
      result.diagnostics.some(
        (d) => d.line === 2 && d.severity === 'error' && /spaces/i.test(d.message)
      )
    ).toBe(true);
  });

  it('flags a tab-indented command with no target', () => {
    const result = validateDocument('makefile', '\techo "orphan"\n');
    expect(
      result.diagnostics.some((d) => d.severity === 'error' && /no preceding target/i.test(d.message))
    ).toBe(true);
  });

  it('accepts a canonical Makefile without diagnostics', () => {
    const result = validateDocument(
      'makefile',
      [
        'CC = gcc',
        '',
        '.PHONY: all',
        'all: hello',
        '\t$(CC) -o hello hello.c',
        '',
      ].join('\n')
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('flags a duplicate Makefile target definition', () => {
    const result = validateDocument(
      'makefile',
      ['build:', '\t@echo first', '', 'build:', '\t@echo second', ''].join('\n')
    );
    expect(
      result.diagnostics.some(
        (d) => d.line === 4 && d.severity === 'warning' && /already defined/i.test(d.message)
      )
    ).toBe(true);
  });

  it('detects duplicate targets even when combined on one line', () => {
    const result = validateDocument(
      'makefile',
      ['all build:', '\t@echo combined', '', 'build:', '\t@echo again', ''].join('\n')
    );
    expect(
      result.diagnostics.some((d) => /"build" is already defined/i.test(d.message))
    ).toBe(true);
  });

  it('reminds the user to add common virtual targets to .PHONY', () => {
    const result = validateDocument(
      'makefile',
      ['clean:', '\trm -rf dist', '', 'test:', '\t@echo test', ''].join('\n')
    );
    const phonyNotices = result.diagnostics.filter((d) => /\.PHONY/i.test(d.message));
    expect(phonyNotices.some((d) => d.message.includes('"clean"'))).toBe(true);
    expect(phonyNotices.some((d) => d.message.includes('"test"'))).toBe(true);
    for (const notice of phonyNotices) {
      expect(notice.severity).toBe('info');
    }
  });

  it('does not nag when common virtual targets are already in .PHONY', () => {
    const result = validateDocument(
      'makefile',
      ['.PHONY: clean test', 'clean:', '\trm -rf dist', '', 'test:', '\t@echo hi', ''].join('\n')
    );
    expect(result.diagnostics.some((d) => /\.PHONY/i.test(d.message))).toBe(false);
  });

  it('flags USER root and USER 0 in a Dockerfile as info', () => {
    const asRoot = validateDocument(
      'dockerfile',
      'FROM node:20\nUSER root\nCMD ["node"]\n'
    );
    expect(
      asRoot.diagnostics.some((d) => d.severity === 'info' && /non-root user/i.test(d.message))
    ).toBe(true);

    const asUid0 = validateDocument(
      'dockerfile',
      'FROM node:20\nUSER 0\nCMD ["node"]\n'
    );
    expect(
      asUid0.diagnostics.some((d) => d.severity === 'info' && /non-root user/i.test(d.message))
    ).toBe(true);
  });

  it('does not warn on a non-root USER declaration', () => {
    const result = validateDocument(
      'dockerfile',
      'FROM node:20\nUSER node\nCMD ["node"]\n'
    );
    expect(result.diagnostics.some((d) => /non-root user/i.test(d.message))).toBe(false);
  });
});
