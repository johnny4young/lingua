import { describe, expect, it } from 'vitest';
import {
  collectImportWarnings,
  deriveRequestName,
  firstNotebookCodeLanguage,
  previewImportSource,
  withImportVariableSource,
} from '@/hooks/importPreviewModel';

describe('importPreviewModel', () => {
  it('returns closed preview states for empty, unknown, and cURL sources', () => {
    expect(previewImportSource('  ')).toMatchObject({
      phase: 'rejected',
      reason: 'empty-input',
    });
    expect(previewImportSource('GET / HTTP/1.1')).toMatchObject({
      phase: 'rejected',
      reason: 'unrecognized-format',
    });

    const previewed = previewImportSource(
      'curl -X POST https://api.example.com/items -d "{}"'
    );
    expect(previewed).toMatchObject({
      phase: 'previewed',
      importerId: 'curl-http',
      preview: { kind: 'curl-http' },
    });
    expect(previewed.sourceBytes).toBeGreaterThan(0);
  });

  it('deduplicates lossy warnings only for previewed inputs', () => {
    const state = previewImportSource(
      'curl -u user:pass --basic https://api.example.com/me'
    );
    expect(collectImportWarnings(state)).toEqual(['curl-basic-auth']);
    expect(
      collectImportWarnings({ phase: 'idle', sourceBytes: 0 })
    ).toEqual([]);
  });

  it('re-previews Postman collections with cleaned variable sources', () => {
    const collection = previewImportSource(
      JSON.stringify({
        info: {
          name: 'Vars',
          schema:
            'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [
          {
            name: 'List',
            request: { method: 'GET', url: '{{baseUrl}}/users' },
          },
        ],
      })
    );
    const next = withImportVariableSource(
      collection,
      'environment',
      JSON.stringify({
        _postman_variable_scope: 'environment',
        values: [{ key: 'baseUrl', value: 'https://api.dev', enabled: true }],
      })
    );

    expect(next.variableStatus?.environment).toMatchObject({
      ok: true,
      count: 1,
    });
    expect(next.variableSources?.environment).toBeDefined();
    expect(next.preview?.kind).toBe('http-collection');
    if (next.preview?.kind !== 'http-collection') {
      throw new Error('expected collection preview');
    }
    expect(next.preview.requests[0]?.url).toBe('https://api.dev/users');

    const cleared = withImportVariableSource(next, 'environment', '   ');
    expect(cleared.variableSources?.environment).toBeUndefined();
  });

  it('keeps non-Postman states unchanged when variable sources change', () => {
    const curl = previewImportSource('curl https://example.com');
    expect(withImportVariableSource(curl, 'globals', '{}')).toBe(curl);
  });

  it('derives request names and the first notebook code language', () => {
    expect(
      deriveRequestName({
        method: 'GET',
        url: 'https://api.example.com/items/42',
        headers: [],
      })
    ).toBe('api.example.com/items');
    expect(
      deriveRequestName({ method: 'POST', url: 'not a url', headers: [] })
    ).toBe('POST import');
    expect(
      firstNotebookCodeLanguage({
        version: 1,
        id: 'notebook',
        title: 'Notebook',
        cells: [
          { kind: 'markdown', id: 'm1', source: '# Notes' },
          {
            kind: 'code',
            id: 'c1',
            language: 'python',
            source: 'print(1)',
            outputs: [],
          },
        ],
      })
    ).toBe('python');
  });
});
