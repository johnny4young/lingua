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
});
