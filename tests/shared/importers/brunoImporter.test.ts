/**
 * implementation (implementation note) — Bruno `.bru` importer adapter coverage.
 *
 * Pins detection, the block parser (method / headers / auth / body /
 * scripts / meta), the lossy-warning surface, and the reject paths.
 */

import { describe, expect, it } from 'vitest';
import {
  brunoImporterAdapter,
  previewBrunoDirectory,
} from '../../../src/shared/importers/brunoImporter';
import type {
  CollectionImporterPreview,
  CollectionImporterResult,
} from '../../../src/shared/importers/postmanImporter';

function preview(source: string): CollectionImporterPreview {
  const outcome = brunoImporterAdapter.preview(source);
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error('expected ok preview');
  return outcome.preview as CollectionImporterPreview;
}

const GET_BRU = `meta {
  name: Get users
  type: http
}

get {
  url: https://api.example.com/users
  auth: bearer
}

headers {
  Accept: application/json
  ~X-Debug: 1
}

auth:bearer {
  token: {{token}}
}
`;

describe('brunoImporterAdapter — surface', () => {
  it('declares the canonical id + i18n keys', () => {
    expect(brunoImporterAdapter.id).toBe('bruno-collection');
    expect(brunoImporterAdapter.titleKey).toBe('importPreview.importer.brunoCollection.title');
    expect(brunoImporterAdapter.descriptionKey).toBe(
      'importPreview.importer.brunoCollection.description'
    );
  });
});

describe('brunoImporterAdapter.detect', () => {
  it('claims a .bru request file', () => {
    expect(brunoImporterAdapter.detect(GET_BRU)).toBe(true);
  });

  it('claims an OpenCollection YAML request', () => {
    expect(
      brunoImporterAdapter.detect(
        `info:\n  name: Create user\n  type: http\nhttp:\n  method: post\n  url: https://api.example.com/users\n`
      )
    ).toBe(true);
  });

  it('does not claim JSON / cURL / prose', () => {
    expect(brunoImporterAdapter.detect('{"info":{},"item":[]}')).toBe(false);
    expect(brunoImporterAdapter.detect('curl https://x.dev')).toBe(false);
    expect(brunoImporterAdapter.detect('just some words here')).toBe(false);
  });
});

describe('brunoImporterAdapter.preview', () => {
  it('parses method, url, headers, meta name + bearer auth', () => {
    const p = preview(GET_BRU);
    expect(p.kind).toBe('http-collection');
    expect(p.source).toBe('bruno');
    expect(p.title).toBe('Get users');
    expect(p.counts.total).toBe(1);
    const req = p.requests[0];
    expect(req?.method).toBe('GET');
    expect(req?.url).toBe('https://api.example.com/users');
    expect(req?.name).toBe('Get users');
    // Accept header + disabled X-Debug + bearer Authorization.
    expect(req?.headers).toEqual([
      { name: 'Accept', value: 'application/json', enabled: true },
      { name: 'X-Debug', value: '1', enabled: false },
      { name: 'Authorization', value: 'Bearer {{token}}', enabled: true },
    ]);
  });

  it('parses a POST with a json body', () => {
    const p = preview(`post {
  url: https://x.dev/items
}

body:json {
  {
    "name": "foo"
  }
}
`);
    const req = p.requests[0];
    expect(req?.method).toBe('POST');
    expect(req?.body?.kind).toBe('json');
    expect(req?.body?.content).toContain('"name": "foo"');
  });

  it('keeps braces inside quoted JSON strings while tokenizing blocks', () => {
    const p = preview(`post {
  url: https://x.dev/items
}

body:json {
  {
    "template": "hello {name}"
  }
}
`);
    expect(p.requests[0]?.body?.content).toContain('hello {name}');
  });

  it('warns when a script / tests block is present', () => {
    const p = preview(`get {
  url: https://x.dev
}

script:pre-request {
  bru.setVar('x', 1)
}
`);
    expect(p.warnings).toContain('bruno-script-dropped');
  });

  it('parses OpenCollection YAML headers, bearer auth, and JSON body', () => {
    const p = preview(`info:
  name: Create user
  type: http
http:
  method: post
  url: https://api.example.com/users
  headers:
    - name: Accept
      value: application/json
      enabled: true
  auth:
    type: bearer
    token: "{{token}}"
  body:
    type: json
    data:
      name: Ada
`);
    expect(p.requests[0]).toMatchObject({
      name: 'Create user',
      method: 'POST',
      url: 'https://api.example.com/users',
      body: { kind: 'json' },
    });
    expect(p.requests[0]?.headers).toEqual([
      { name: 'Accept', value: 'application/json', enabled: true },
      { name: 'Authorization', value: 'Bearer {{token}}', enabled: true },
    ]);
    expect(p.requests[0]?.body?.content).toContain('"name": "Ada"');
  });

  it('warns when OpenCollection runtime scripts or assertions are present', () => {
    const p = preview(`info:
  name: Runtime request
  type: http
http:
  method: get
  url: https://api.example.com/users
runtime:
  scripts:
    preRequest: console.log('not imported')
  assertions:
    - expression: res.status == 200
`);
    expect(p.warnings).toContain('bruno-script-dropped');
  });

  it('does not warn for an empty OpenCollection runtime section', () => {
    const p = preview(`info:
  name: Plain request
  type: http
http:
  method: get
  url: https://api.example.com/users
runtime:
  scripts: {}
  assertions: []
`);
    expect(p.warnings).not.toContain('bruno-script-dropped');
  });

  it('drops unsupported multipart bodies and warns about request settings', () => {
    const p = preview(`info:
  name: Upload asset
  type: http
http:
  method: post
  url: https://api.example.com/assets
  body:
    type: multipart-form
    data:
      - name: file
        value: ./avatar.png
settings:
  timeout: 2500
  followRedirects: false
`);
    expect(p.requests[0]?.body).toBeUndefined();
    expect(p.warnings).toEqual(
      expect.arrayContaining(['postman-formdata-file', 'bruno-settings-dropped'])
    );
  });

  it('preserves a GraphQL body as text and marks the lossy mapping', () => {
    const p = preview(`info:
  name: Query user
  type: http
http:
  method: post
  url: https://api.example.com/graphql
  body:
    type: graphql
    data: query { viewer { id } }
`);
    expect(p.requests[0]?.body).toEqual({
      kind: 'text',
      content: 'query { viewer { id } }',
    });
    expect(p.warnings).toContain('postman-graphql-body');
  });
});

describe('previewBrunoDirectory', () => {
  it('flattens mixed classic and OpenCollection requests with folder names', () => {
    const outcome = previewBrunoDirectory('Team API', [
      { relativePath: 'users/list.bru', content: GET_BRU },
      {
        relativePath: 'admin/create.yml',
        content: `info:\n  name: Create admin\n  type: http\nhttp:\n  method: post\n  url: https://api.example.com/admins\n`,
      },
    ]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.preview.title).toBe('Team API');
    expect(outcome.preview.counts).toEqual({ total: 2, folders: 2, truncated: 0 });
    expect(outcome.preview.requests.map(request => request.name)).toEqual([
      'users / Get users',
      'admin / Create admin',
    ]);
  });

  it('ignores unrelated YAML and rejects a folder with no requests', () => {
    const outcome = previewBrunoDirectory('Empty', [
      { relativePath: 'docs.yml', content: 'title: not a request\n' },
    ]);
    expect(outcome).toEqual({
      ok: false,
      reason: 'malformed',
      detail: 'directory-empty',
    });
  });

  it('rejects a recognized request that cannot map to the HTTP workspace', () => {
    const outcome = previewBrunoDirectory('Invalid', [
      {
        relativePath: 'trace.yml',
        content:
          'info:\n  name: Trace\n  type: http\nhttp:\n  method: trace\n  url: https://api.example.com\n',
      },
    ]);
    expect(outcome).toEqual({
      ok: false,
      reason: 'malformed',
      detail: 'directory-invalid-request',
    });
  });

  it('caps a collection at the shared request limit', () => {
    const files = Array.from({ length: 105 }, (_, index) => ({
      relativePath: `requests/request-${index}.bru`,
      content: `meta {\n  name: Request ${index}\n}\nget {\n  url: https://api.example.com/${index}\n}\n`,
    }));
    const outcome = previewBrunoDirectory('Large', files);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.preview.counts).toEqual({ total: 100, folders: 1, truncated: 5 });
  });

  it('counts every distinct ancestor folder in a nested collection', () => {
    const outcome = previewBrunoDirectory('Nested', [
      { relativePath: 'users/admin/list.bru', content: GET_BRU },
    ]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.preview.counts.folders).toBe(2);
  });
});

describe('brunoImporterAdapter.preview — rejects', () => {
  it('empty-input on blank source', () => {
    const outcome = brunoImporterAdapter.preview('   ');
    expect(outcome).toEqual({ ok: false, reason: 'empty-input' });
  });

  it('malformed when there are no blocks', () => {
    const outcome = brunoImporterAdapter.preview('this is not bru');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('malformed');
  });

  it('malformed when a block is missing its closing brace', () => {
    const outcome = brunoImporterAdapter.preview(`get {
  url: https://x.dev
`);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('malformed');
    expect(outcome.detail).toBe('malformed');
  });

  it('invalid-shape when a method block has no url', () => {
    const outcome = brunoImporterAdapter.preview(`get {
  auth: none
}
`);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.detail).toBe('invalid-shape');
  });
});

describe('brunoImporterAdapter.import', () => {
  it('round-trips the single parsed request', () => {
    const p = preview(GET_BRU);
    const result = brunoImporterAdapter.import(p) as CollectionImporterResult;
    expect(result.source).toBe('bruno');
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0]?.url).toBe('https://api.example.com/users');
  });
});
