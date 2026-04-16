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
    expect(supportsValidation('toml')).toBe(false);
  });
});
