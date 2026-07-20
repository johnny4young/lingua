/**
 * implementation — Postman Collection importer adapter coverage.
 *
 * Pins the closed-enum outcomes, folder flattening, url-object
 * reconstruction, body-mode mapping, auth flattening, the lossy-warning
 * surface, truncation, and the rejection paths.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_IMPORT_REQUESTS,
  isSensitiveVariableKey,
  parsePostmanVariableExport,
  postmanImporterAdapter,
  previewPostmanWithVariables,
  type CollectionImporterPreview,
  type CollectionImporterResult,
} from '../../../src/shared/importers/postmanImporter';

function collection(items: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    info: {
      name: 'Demo API',
      schema:
        'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      ...((extra.info as Record<string, unknown>) ?? {}),
    },
    item: items,
    ...extra,
  });
}

function leaf(
  name: string,
  request: Record<string, unknown>
): Record<string, unknown> {
  return { name, request };
}

function preview(source: string): CollectionImporterPreview {
  const outcome = postmanImporterAdapter.preview(source);
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error('expected ok preview');
  return outcome.preview as CollectionImporterPreview;
}

describe('postmanImporterAdapter — surface', () => {
  it('declares the canonical id + i18n keys', () => {
    expect(postmanImporterAdapter.id).toBe('postman-collection');
    expect(postmanImporterAdapter.titleKey).toBe(
      'importPreview.importer.postmanCollection.title'
    );
    expect(postmanImporterAdapter.descriptionKey).toBe(
      'importPreview.importer.postmanCollection.description'
    );
  });
});

describe('postmanImporterAdapter.detect', () => {
  it('claims a v2.1 collection', () => {
    expect(
      postmanImporterAdapter.detect(
        collection([leaf('Ping', { method: 'GET', url: 'https://x.dev' })])
      )
    ).toBe(true);
  });

  it('does not claim cURL / ipynb / plain text / non-JSON', () => {
    expect(postmanImporterAdapter.detect('curl https://x.dev')).toBe(false);
    expect(
      postmanImporterAdapter.detect('{"nbformat":4,"cells":[]}')
    ).toBe(false);
    expect(postmanImporterAdapter.detect('just words')).toBe(false);
    expect(postmanImporterAdapter.detect('{not json')).toBe(false);
  });
});

describe('postmanImporterAdapter.preview — happy paths', () => {
  it('maps a flat two-request collection', () => {
    const p = preview(
      collection([
        leaf('List items', {
          method: 'GET',
          url: 'https://api.example.com/items',
          header: [{ key: 'Accept', value: 'application/json' }],
        }),
        leaf('Create item', {
          method: 'POST',
          url: 'https://api.example.com/items',
          body: { mode: 'raw', raw: '{"name":"foo"}' },
        }),
      ])
    );
    expect(p.kind).toBe('http-collection');
    expect(p.source).toBe('postman');
    expect(p.title).toBe('Demo API');
    expect(p.counts.total).toBe(2);
    expect(p.counts.folders).toBe(0);
    expect(p.requests[0]?.method).toBe('GET');
    expect(p.requests[1]?.method).toBe('POST');
    expect(p.requests[1]?.body).toEqual({ kind: 'json', content: '{"name":"foo"}' });
  });

  it('reconstructs the url from the v2.1 object shape', () => {
    const p = preview(
      collection([
        leaf('Search', {
          method: 'GET',
          url: {
            protocol: 'https',
            host: ['api', 'example', 'com'],
            path: ['v1', 'search'],
            query: [{ key: 'q', value: 'term' }],
          },
        }),
      ])
    );
    expect(p.requests[0]?.url).toBe('https://api.example.com/v1/search?q=term');
  });

  it('skips disabled query params when reconstructing the url object shape', () => {
    const p = preview(
      collection([
        leaf('Search', {
          method: 'GET',
          url: {
            protocol: 'https',
            host: ['api', 'example', 'com'],
            path: ['v1', 'search'],
            query: [
              { key: 'q', value: 'term' },
              { key: 'debug', value: '1', disabled: true },
            ],
          },
        }),
      ])
    );
    expect(p.requests[0]?.url).toBe('https://api.example.com/v1/search?q=term');
  });

  it('prefers url.raw when present', () => {
    const p = preview(
      collection([
        leaf('Raw', {
          method: 'GET',
          url: { raw: 'https://raw.example.com/x', host: ['ignored'] },
        }),
      ])
    );
    expect(p.requests[0]?.url).toBe('https://raw.example.com/x');
  });

  it('flattens nested folders with path-prefixed names + counts folders', () => {
    const p = preview(
      collection([
        {
          name: 'Users',
          item: [
            leaf('Get user', { method: 'GET', url: 'https://x.dev/users/1' }),
            {
              name: 'Admin',
              item: [
                leaf('Ban', { method: 'POST', url: 'https://x.dev/users/1/ban' }),
              ],
            },
          ],
        },
        leaf('Health', { method: 'GET', url: 'https://x.dev/health' }),
      ])
    );
    expect(p.counts.total).toBe(3);
    expect(p.counts.folders).toBe(2);
    expect(p.requests[0]?.name).toBe('Users / Get user');
    expect(p.requests[1]?.name).toBe('Users / Admin / Ban');
    expect(p.requests[2]?.name).toBe('Health');
  });

  it('preserves disabled headers as enabled:false', () => {
    const p = preview(
      collection([
        leaf('X', {
          method: 'GET',
          url: 'https://x.dev',
          header: [
            { key: 'Accept', value: 'application/json' },
            { key: 'X-Debug', value: '1', disabled: true },
          ],
        }),
      ])
    );
    const headers = p.requests[0]?.headers ?? [];
    expect(headers).toHaveLength(2);
    expect(headers[1]).toEqual({ name: 'X-Debug', value: '1', enabled: false });
  });

  it('maps urlencoded body to a form body', () => {
    const p = preview(
      collection([
        leaf('Form', {
          method: 'POST',
          url: 'https://x.dev',
          body: {
            mode: 'urlencoded',
            urlencoded: [
              { key: 'a', value: '1' },
              { key: 'b', value: '2', disabled: true },
            ],
          },
        }),
      ])
    );
    expect(p.requests[0]?.body).toEqual({ kind: 'form', content: 'a=1' });
  });
});

describe('postmanImporterAdapter.preview — auth + lossy warnings', () => {
  it('flattens bearer auth to an Authorization header', () => {
    const p = preview(
      collection([
        leaf('Secured', {
          method: 'GET',
          url: 'https://x.dev',
          auth: { type: 'bearer', bearer: [{ key: 'token', value: 'abc123' }] },
        }),
      ])
    );
    const auth = p.requests[0]?.headers.find((h) => h.name === 'Authorization');
    expect(auth?.value).toBe('Bearer abc123');
  });

  it('inherits collection bearer auth for leaf requests without request auth', () => {
    const p = preview(
      collection(
        [
          leaf('Secured', {
            method: 'GET',
            url: 'https://x.dev',
          }),
        ],
        {
          auth: {
            type: 'bearer',
            bearer: [{ key: 'token', value: 'collection-token' }],
          },
        }
      )
    );
    const auth = p.requests[0]?.headers.find((h) => h.name === 'Authorization');
    expect(auth?.value).toBe('Bearer collection-token');
  });

  it('lets request-level noauth override inherited collection auth', () => {
    const p = preview(
      collection(
        [
          leaf('Public', {
            method: 'GET',
            url: 'https://x.dev/public',
            auth: { type: 'noauth' },
          }),
        ],
        {
          auth: {
            type: 'bearer',
            bearer: [{ key: 'token', value: 'collection-token' }],
          },
        }
      )
    );
    expect(
      p.requests[0]?.headers.some((h) => h.name === 'Authorization')
    ).toBe(false);
  });

  it('warns on non-bearer auth helpers', () => {
    const p = preview(
      collection([
        leaf('Basic', {
          method: 'GET',
          url: 'https://x.dev',
          auth: { type: 'basic', basic: [{ key: 'username', value: 'u' }] },
        }),
      ])
    );
    expect(p.warnings).toContain('postman-auth-helper');
  });

  it('warns on pre-request + test scripts', () => {
    const p = preview(
      collection([
        {
          name: 'Scripted',
          request: { method: 'GET', url: 'https://x.dev' },
          event: [
            { listen: 'prerequest', script: { exec: ['console.log(1)'] } },
            { listen: 'test', script: { exec: ['pm.test()'] } },
          ],
        },
      ])
    );
    expect(p.warnings).toContain('postman-prerequest-script');
    expect(p.warnings).toContain('postman-test-script');
  });

  it('warns on collection-level and folder-level scripts', () => {
    const p = preview(
      collection(
        [
          {
            name: 'Folder',
            event: [{ listen: 'test', script: { exec: ['pm.test()'] } }],
            item: [
              leaf('Leaf', {
                method: 'GET',
                url: 'https://x.dev',
              }),
            ],
          },
        ],
        {
          event: [
            {
              listen: 'prerequest',
              script: { exec: ['pm.environment.set("x", "1")'] },
            },
          ],
        }
      )
    );
    expect(p.warnings).toContain('postman-prerequest-script');
    expect(p.warnings).toContain('postman-test-script');
  });

  it('does NOT warn on an empty script block', () => {
    const p = preview(
      collection([
        {
          name: 'Empty script',
          request: { method: 'GET', url: 'https://x.dev' },
          event: [{ listen: 'prerequest', script: { exec: ['', '  '] } }],
        },
      ])
    );
    expect(p.warnings).not.toContain('postman-prerequest-script');
  });

  it('warns on unresolved {{variables}}', () => {
    const p = preview(
      collection([
        leaf('Var', { method: 'GET', url: 'https://{{base_url}}/items' }),
      ])
    );
    expect(p.warnings).toContain('postman-variable');
    expect(p.requests[0]?.url).toBe('https://{{base_url}}/items');
  });

  it('warns on unresolved {{variables}} inside request bodies', () => {
    const p = preview(
      collection([
        leaf('Body var', {
          method: 'POST',
          url: 'https://x.dev',
          body: { mode: 'raw', raw: '{"token":"{{token}}"}' },
        }),
      ])
    );
    expect(p.warnings).toContain('postman-variable');
    expect(p.requests[0]?.body).toEqual({
      kind: 'json',
      content: '{"token":"{{token}}"}',
    });
  });

  it('warns + keeps query text for a graphql body', () => {
    const p = preview(
      collection([
        leaf('GQL', {
          method: 'POST',
          url: 'https://x.dev/graphql',
          body: { mode: 'graphql', graphql: { query: '{ me { id } }' } },
        }),
      ])
    );
    expect(p.warnings).toContain('postman-graphql-body');
    expect(p.requests[0]?.body).toEqual({ kind: 'text', content: '{ me { id } }' });
  });

  it('warns on a formdata file part', () => {
    const p = preview(
      collection([
        leaf('Upload', {
          method: 'POST',
          url: 'https://x.dev/upload',
          body: {
            mode: 'formdata',
            formdata: [
              { key: 'caption', value: 'hi', type: 'text' },
              { key: 'photo', type: 'file' },
            ],
          },
        }),
      ])
    );
    expect(p.warnings).toContain('postman-formdata-file');
    expect(p.requests[0]?.body).toEqual({ kind: 'form', content: 'caption=hi' });
  });
});

describe('postmanImporterAdapter.preview — collection variable resolution', () => {
  it('resolves a collection variable in the url + reports the resolved count', () => {
    const p = preview(
      collection([leaf('Get', { method: 'GET', url: 'https://{{base_url}}/items' })], {
        variable: [{ key: 'base_url', value: 'api.example.com' }],
      })
    );
    expect(p.requests[0]?.url).toBe('https://api.example.com/items');
    expect(p.warnings).not.toContain('postman-variable');
    expect(p.counts.variablesResolved).toBe(1);
    expect(p.counts.variablesUnresolved).toBe(0);
  });

  it('resolves variables in header names + values (implementation note)', () => {
    const p = preview(
      collection(
        [
          leaf('H', {
            method: 'GET',
            url: 'https://x.dev',
            header: [
              { key: '{{hdrName}}', value: '{{apiKey}}' },
              { key: 'Static', value: 'plain' },
            ],
          }),
        ],
        {
          variable: [
            { key: 'hdrName', value: 'X-Api-Key' },
            { key: 'apiKey', value: 'secret-token' },
          ],
        }
      )
    );
    const headers = p.requests[0]?.headers ?? [];
    expect(headers[0]).toEqual({ name: 'X-Api-Key', value: 'secret-token', enabled: true });
    expect(headers[1]).toEqual({ name: 'Static', value: 'plain', enabled: true });
    expect(p.warnings).not.toContain('postman-variable');
  });

  it('resolves variables inside a request body (kind preserved)', () => {
    const p = preview(
      collection(
        [
          leaf('B', {
            method: 'POST',
            url: 'https://x.dev',
            body: { mode: 'raw', raw: '{"token":"{{token}}"}' },
          }),
        ],
        { variable: [{ key: 'token', value: 'abc123' }] }
      )
    );
    expect(p.requests[0]?.body).toEqual({ kind: 'json', content: '{"token":"abc123"}' });
    expect(p.warnings).not.toContain('postman-variable');
  });

  it('resolves transitive references through the variable map (implementation note)', () => {
    const p = preview(
      collection([leaf('T', { method: 'GET', url: 'https://{{fullHost}}/v1' })], {
        variable: [
          { key: 'fullHost', value: '{{sub}}.example.com' },
          { key: 'sub', value: 'api' },
        ],
      })
    );
    expect(p.requests[0]?.url).toBe('https://api.example.com/v1');
    expect(p.warnings).not.toContain('postman-variable');
  });

  it('terminates on a variable reference cycle, leaving it literal (implementation note guard)', () => {
    const p = preview(
      collection([leaf('C', { method: 'GET', url: 'https://x.dev/{{a}}' })], {
        variable: [
          { key: 'a', value: '{{b}}' },
          { key: 'b', value: '{{a}}' },
        ],
      })
    );
    // The cycle guard leaves the unexpandable reference literal rather
    // than looping; the import still settles.
    expect(p.requests[0]?.url).toBe('https://x.dev/{{a}}');
    expect(p.warnings).toContain('postman-variable');
    expect(p.counts.variablesUnresolved).toBe(1);
  });

  it('warns when a collection variable expands to an unknown nested token', () => {
    const p = preview(
      collection([leaf('T', { method: 'GET', url: 'https://{{fullHost}}/v1' })], {
        variable: [{ key: 'fullHost', value: '{{envHost}}' }],
      })
    );
    expect(p.requests[0]?.url).toBe('https://{{envHost}}/v1');
    expect(p.warnings).toContain('postman-variable');
    expect(p.counts.variablesResolved).toBe(1);
    expect(p.counts.variablesUnresolved).toBe(1);
  });

  it('treats malformed non-string collection variables as unresolved', () => {
    const p = preview(
      collection([leaf('N', { method: 'GET', url: 'https://{{port}}/v1' })], {
        variable: [{ key: 'port', value: 443 }],
      })
    );
    expect(p.requests[0]?.url).toBe('https://{{port}}/v1');
    expect(p.warnings).toContain('postman-variable');
    expect(p.counts.variablesResolved).toBe(0);
    expect(p.counts.variablesUnresolved).toBe(1);
  });

  it('keeps a dynamic {{$guid}} literal + warns distinctly (implementation note)', () => {
    const p = preview(
      collection([leaf('D', { method: 'GET', url: 'https://x.dev/{{$guid}}' })])
    );
    expect(p.requests[0]?.url).toBe('https://x.dev/{{$guid}}');
    expect(p.warnings).toContain('postman-dynamic-variable');
    expect(p.warnings).not.toContain('postman-variable');
    expect(p.counts.variablesUnresolved).toBe(0);
  });

  it('skips disabled collection variables (left unresolved + warned)', () => {
    const p = preview(
      collection([leaf('X', { method: 'GET', url: 'https://{{base}}/x' })], {
        variable: [{ key: 'base', value: 'real.com', disabled: true }],
      })
    );
    expect(p.requests[0]?.url).toBe('https://{{base}}/x');
    expect(p.warnings).toContain('postman-variable');
    expect(p.counts.variablesUnresolved).toBe(1);
    expect(p.counts.variablesResolved).toBe(0);
  });

  it('resolves variables in folder + request names (implementation note)', () => {
    const p = preview(
      collection(
        [
          {
            name: '{{folderName}}',
            item: [leaf('{{reqName}}', { method: 'GET', url: 'https://x.dev' })],
          },
        ],
        {
          variable: [
            { key: 'folderName', value: 'Users' },
            { key: 'reqName', value: 'List' },
          ],
        }
      )
    );
    expect(p.requests[0]?.name).toBe('Users / List');
  });

  it('mixes resolved + unresolved: substitutes known, warns on the rest', () => {
    const p = preview(
      collection([leaf('M', { method: 'GET', url: 'https://{{base}}/{{missing}}' })], {
        variable: [{ key: 'base', value: 'api.com' }],
      })
    );
    expect(p.requests[0]?.url).toBe('https://api.com/{{missing}}');
    expect(p.warnings).toContain('postman-variable');
    expect(p.counts.variablesResolved).toBe(1);
    expect(p.counts.variablesUnresolved).toBe(1);
  });

  it('trims whitespace inside the braces when matching keys', () => {
    const p = preview(
      collection([leaf('W', { method: 'GET', url: 'https://{{ base }}/x' })], {
        variable: [{ key: 'base', value: 'api.com' }],
      })
    );
    expect(p.requests[0]?.url).toBe('https://api.com/x');
  });

  it('round-trips resolved values through import()', () => {
    const p = preview(
      collection([leaf('R', { method: 'GET', url: 'https://{{base}}/x' })], {
        variable: [{ key: 'base', value: 'api.com' }],
      })
    );
    const result = postmanImporterAdapter.import(p) as CollectionImporterResult;
    expect(result.requests[0]?.url).toBe('https://api.com/x');
  });
});

describe('postmanImporterAdapter.preview — caps + rejects', () => {
  it('truncates beyond MAX_IMPORT_REQUESTS and reports the dropped count', () => {
    const items = Array.from({ length: MAX_IMPORT_REQUESTS + 5 }, (_, i) =>
      leaf(`R${i}`, { method: 'GET', url: `https://x.dev/${i}` })
    );
    const p = preview(collection(items));
    expect(p.counts.total).toBe(MAX_IMPORT_REQUESTS);
    expect(p.requests).toHaveLength(MAX_IMPORT_REQUESTS);
    expect(p.counts.truncated).toBe(5);
  });

  it('empty-input on blank source', () => {
    const outcome = postmanImporterAdapter.preview('   ');
    expect(outcome).toEqual({ ok: false, reason: 'empty-input' });
  });

  it('malformed-json on unparseable JSON', () => {
    const outcome = postmanImporterAdapter.preview('{"info":{},"item":[');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('malformed');
    expect(outcome.detail).toBe('malformed-json');
  });

  it('invalid-shape when info is missing', () => {
    const outcome = postmanImporterAdapter.preview(
      JSON.stringify({ item: [] })
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.detail).toBe('invalid-shape');
  });

  it('wrong-version on a non-2.x schema', () => {
    const outcome = postmanImporterAdapter.preview(
      collection([], { info: { schema: 'https://schema.getpostman.com/json/collection/v1.0.0/collection.json' } })
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unsupported-feature');
    expect(outcome.detail).toBe('wrong-version');
  });

  it('wrong-version when item is absent (v1 collection)', () => {
    const outcome = postmanImporterAdapter.preview(
      JSON.stringify({ info: { name: 'Old' }, requests: [] })
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.detail).toBe('wrong-version');
  });

  it('empty-collection when there are no requests', () => {
    const outcome = postmanImporterAdapter.preview(collection([]));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.detail).toBe('empty-collection');
  });

  it('empty-collection when only folders with no leaf requests', () => {
    const outcome = postmanImporterAdapter.preview(
      collection([{ name: 'Empty folder', item: [] }])
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.detail).toBe('empty-collection');
  });
});

describe('postmanImporterAdapter.import', () => {
  it('round-trips the parsed requests', () => {
    const p = preview(
      collection([
        leaf('A', {
          method: 'POST',
          url: 'https://x.dev/a',
          header: [{ key: 'Authorization', value: 'Bearer secret' }],
        }),
      ])
    );
    const result = postmanImporterAdapter.import(p) as CollectionImporterResult;
    expect(result.source).toBe('postman');
    expect(result.requests).toHaveLength(1);
    // Original Authorization value round-trips on import (redaction is
    // display-only).
    expect(result.requests[0]?.headers[0]?.value).toBe('Bearer secret');
  });
});

// ---------------------------------------------------------------------------
// implementation — environment / globals variable resolution
// ---------------------------------------------------------------------------

function variableExport(
  values: Array<{ key: string; value: string; enabled?: boolean }>,
  scope?: 'environment' | 'globals'
): string {
  return JSON.stringify({
    ...(scope ? { _postman_variable_scope: scope } : {}),
    name: 'Vars',
    values,
  });
}

describe('parsePostmanVariableExport ', () => {
  it('parses enabled key/value entries and reports the scope', () => {
    const out = parsePostmanVariableExport(
      variableExport(
        [
          { key: 'baseUrl', value: 'https://api.dev', enabled: true },
          { key: 'token', value: 'secret123', enabled: true },
        ],
        'environment'
      )
    );
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected ok');
    expect(out.export.scope).toBe('environment');
    expect(out.export.map.get('baseUrl')).toBe('https://api.dev');
    expect(out.export.count).toBe(2);
  });

  it('skips disabled entries', () => {
    const out = parsePostmanVariableExport(
      variableExport([
        { key: 'a', value: '1', enabled: true },
        { key: 'b', value: '2', enabled: false },
      ])
    );
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected ok');
    expect(out.export.map.has('b')).toBe(false);
    expect(out.export.count).toBe(1);
  });

  it('detects the globals scope', () => {
    const out = parsePostmanVariableExport(
      variableExport([{ key: 'g', value: '1', enabled: true }], 'globals')
    );
    expect(out.ok && out.export.scope).toBe('globals');
  });

  it('rejects non-JSON, wrong-shape, empty, and a collection', () => {
    expect(parsePostmanVariableExport('not json')).toMatchObject({
      ok: false,
      reason: 'not-json',
    });
    expect(parsePostmanVariableExport('{"foo":1}')).toMatchObject({
      ok: false,
      reason: 'wrong-shape',
    });
    expect(parsePostmanVariableExport('')).toMatchObject({
      ok: false,
      reason: 'wrong-shape',
    });
    expect(
      parsePostmanVariableExport(JSON.stringify({ info: {}, item: [] }))
    ).toMatchObject({ ok: false, reason: 'is-collection' });
  });
});

describe('isSensitiveVariableKey (implementation note)', () => {
  it('flags secret-like key names', () => {
    for (const key of [
      'token',
      'apiKey',
      'api_key',
      'authToken',
      'password',
      'clientSecret',
      'accessKey',
      'bearer',
    ]) {
      expect(isSensitiveVariableKey(key)).toBe(true);
    }
  });

  it('does not flag plain key names', () => {
    for (const key of ['baseUrl', 'host', 'version', 'userId', 'page']) {
      expect(isSensitiveVariableKey(key)).toBe(false);
    }
  });
});

describe('previewPostmanWithVariables ', () => {
  const coll = collection(
    [leaf('Get user', { method: 'GET', url: '{{baseUrl}}/users?key={{apiKey}}' })],
    { variable: [{ key: 'baseUrl', value: 'https://fallback.example' }] }
  );
  const envSource = variableExport(
    [
      { key: 'baseUrl', value: 'https://api.dev', enabled: true },
      { key: 'apiKey', value: 'supersecret', enabled: true },
    ],
    'environment'
  );

  it('merges env vars with env > collection precedence into the real URL', () => {
    const { outcome } = previewPostmanWithVariables(coll, {
      environment: envSource,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    const req = outcome.preview.requests[0]!;
    expect(req.url).toContain('https://api.dev'); // env overrode the fallback
    expect(req.url).toContain('supersecret'); // resolved from env
  });

  it('counts env-sourced resolutions (implementation note)', () => {
    const { outcome } = previewPostmanWithVariables(coll, {
      environment: envSource,
    });
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.preview.counts.variablesResolvedFromEnv).toBe(2);
  });

  it('redacts a sensitive env value in the display URL, keeps the real URL (implementation note)', () => {
    const { outcome } = previewPostmanWithVariables(coll, {
      environment: envSource,
    });
    if (!outcome.ok) throw new Error('expected ok');
    const req = outcome.preview.requests[0]!;
    expect(req.url).toContain('supersecret');
    expect(req.displayUrl).toBeDefined();
    expect(req.displayUrl).toContain('<redacted>');
    expect(req.displayUrl).not.toContain('supersecret');
    // Non-sensitive baseUrl stays visible in the redacted display URL.
    expect(req.displayUrl).toContain('https://api.dev');
  });

  it('redacts sensitive env values that flow through collection variables', () => {
    const c = collection(
      [leaf('R', { method: 'GET', url: '{{baseUrl}}/users' })],
      { variable: [{ key: 'baseUrl', value: 'https://api.dev?key={{apiKey}}' }] }
    );
    const { outcome } = previewPostmanWithVariables(c, {
      environment: variableExport([
        { key: 'apiKey', value: 'supersecret', enabled: true },
      ]),
    });
    if (!outcome.ok) throw new Error('expected ok');
    const req = outcome.preview.requests[0]!;
    expect(outcome.preview.counts.variablesResolvedFromEnv).toBe(1);
    expect(req.url).toContain('supersecret');
    expect(req.displayUrl).toContain('<redacted>');
    expect(req.displayUrl).not.toContain('supersecret');
  });

  it('lists still-unresolved variable names (implementation note)', () => {
    const c = collection([
      leaf('R', { method: 'GET', url: '{{baseUrl}}/{{missing}}' }),
    ]);
    const { outcome } = previewPostmanWithVariables(c, {
      environment: variableExport([
        { key: 'baseUrl', value: 'https://x', enabled: true },
      ]),
    });
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.preview.unresolvedVariableNames).toContain('missing');
    expect(outcome.preview.unresolvedVariableNames).not.toContain('baseUrl');
  });

  it('applies globals below environment precedence', () => {
    const c = collection([leaf('R', { method: 'GET', url: '{{a}}-{{b}}' })]);
    const { outcome } = previewPostmanWithVariables(c, {
      environment: variableExport([{ key: 'a', value: 'ENV', enabled: true }]),
      globals: variableExport([
        { key: 'a', value: 'GLOB', enabled: true },
        { key: 'b', value: 'GB', enabled: true },
      ]),
    });
    if (!outcome.ok) throw new Error('expected ok');
    // env wins for `a`; globals supplies `b`.
    expect(outcome.preview.requests[0]!.url).toBe('ENV-GB');
  });

  it('reports per-slot parse status; a malformed slot is ignored, not fatal', () => {
    const { outcome, variableStatus } = previewPostmanWithVariables(coll, {
      environment: envSource,
      globals: 'not json',
    });
    expect(outcome.ok).toBe(true);
    expect(variableStatus.environment).toMatchObject({ ok: true, count: 2 });
    expect(variableStatus.globals).toMatchObject({ ok: false, reason: 'not-json' });
  });

  it('leaves variablesResolvedFromEnv undefined when no source is supplied', () => {
    const outcome = postmanImporterAdapter.preview(coll);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.preview.counts.variablesResolvedFromEnv).toBeUndefined();
  });
});
