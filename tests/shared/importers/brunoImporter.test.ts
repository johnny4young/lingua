/**
 * RL-100 Slice 3 (fold D) — Bruno `.bru` importer adapter coverage.
 *
 * Pins detection, the block parser (method / headers / auth / body /
 * scripts / meta), the lossy-warning surface, and the reject paths.
 */

import { describe, expect, it } from 'vitest';
import {
  brunoImporterAdapter,
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
    expect(brunoImporterAdapter.titleKey).toBe(
      'importPreview.importer.brunoCollection.title'
    );
    expect(brunoImporterAdapter.descriptionKey).toBe(
      'importPreview.importer.brunoCollection.description'
    );
  });
});

describe('brunoImporterAdapter.detect', () => {
  it('claims a .bru request file', () => {
    expect(brunoImporterAdapter.detect(GET_BRU)).toBe(true);
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
