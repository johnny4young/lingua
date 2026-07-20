/**
 * implementation — cURL importer adapter unit tests.
 *
 * Covers detect → preview → import phases plus the new lossy-flag
 * warning scanner + sensitive-header redaction layer that the
 * implementation `tryParseCurl` did not have.
 */

import { describe, expect, it } from 'vitest';
import {
  curlImporterAdapter,
  type CurlImporterPreview,
} from '../../../src/shared/importers/curlImporter';

function expectPreview(
  source: string
): { preview: CurlImporterPreview } {
  const outcome = curlImporterAdapter.preview(source);
  if (!outcome.ok) {
    throw new Error(`expected preview to succeed; got reason=${outcome.reason}`);
  }
  return { preview: outcome.preview };
}

describe('curlImporterAdapter.detect', () => {
  it('matches a basic cURL line', () => {
    expect(curlImporterAdapter.detect('curl https://example.com')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(curlImporterAdapter.detect('CURL https://example.com')).toBe(true);
  });

  it('rejects non-cURL input', () => {
    expect(curlImporterAdapter.detect('GET / HTTP/1.1')).toBe(false);
    expect(curlImporterAdapter.detect('https://example.com')).toBe(false);
  });

  it('rejects empty / non-string input', () => {
    expect(curlImporterAdapter.detect('')).toBe(false);
    expect(curlImporterAdapter.detect('   ')).toBe(false);
  });
});

describe('curlImporterAdapter.preview', () => {
  it('returns empty-input on a blank source', () => {
    const outcome = curlImporterAdapter.preview('   ');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('empty-input');
  });

  it('returns unrecognized-format on non-cURL source', () => {
    const outcome = curlImporterAdapter.preview('GET / HTTP/1.1');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unrecognized-format');
  });

  it('returns malformed when the parser cannot find a URL', () => {
    const outcome = curlImporterAdapter.preview('curl');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('malformed');
  });

  it('parses a minimal GET', () => {
    const { preview } = expectPreview('curl https://example.com/path');
    expect(preview.original.method).toBe('GET');
    expect(preview.original.url).toBe('https://example.com/path');
    expect(preview.warnings).toEqual([]);
  });

  it('parses POST with JSON body and infers Content-Type', () => {
    const { preview } = expectPreview(
      'curl -X POST https://api.example.com/items -d \'{"name":"foo"}\''
    );
    expect(preview.original.method).toBe('POST');
    expect(preview.original.body?.kind).toBe('json');
    expect(preview.original.body?.content).toBe('{"name":"foo"}');
    expect(
      preview.original.headers.some(
        (h) => h.name.toLowerCase() === 'content-type'
      )
    ).toBe(true);
  });

  it('redacts Authorization in the preview but keeps the original', () => {
    const { preview } = expectPreview(
      'curl -H "Authorization: Bearer secret-token" https://api.example.com/me'
    );
    const redactedAuth = preview.redacted.headers.find(
      (h) => h.name.toLowerCase() === 'authorization'
    );
    const originalAuth = preview.original.headers.find(
      (h) => h.name.toLowerCase() === 'authorization'
    );
    expect(redactedAuth?.value).toBe('<redacted>');
    expect(originalAuth?.value).toBe('Bearer secret-token');
  });

  it('redacts Cookie + X-API-Key case-insensitively', () => {
    const { preview } = expectPreview(
      'curl -H "cookie: session=xyz" -H "X-Api-Key: kkk" https://example.com'
    );
    const values = preview.redacted.headers.map((h) => h.value);
    expect(values).toContain('<redacted>');
    expect(values.filter((v) => v === '<redacted>')).toHaveLength(2);
  });

  it('does NOT redact non-sensitive headers like Accept', () => {
    const { preview } = expectPreview(
      'curl -H "Accept: application/json" https://example.com'
    );
    const accept = preview.redacted.headers.find(
      (h) => h.name.toLowerCase() === 'accept'
    );
    expect(accept?.value).toBe('application/json');
  });

  it('emits curl-basic-auth warning for -u', () => {
    const { preview } = expectPreview(
      'curl -u user:pass https://api.example.com'
    );
    expect(preview.warnings).toContain('curl-basic-auth');
  });

  it('skips the argument of lossy flags so the real URL is preserved', () => {
    // Regression: previously `-u admin:hunter2` left `admin:hunter2`
    // dangling, and the parser misread it as the URL (dropping
    // `https://api.example.com/upload`).
    const { preview } = expectPreview(
      'curl -u admin:hunter2 -F file=@photo.jpg https://api.example.com/upload'
    );
    expect(preview.original.url).toBe('https://api.example.com/upload');
    expect(preview.warnings).toEqual(
      expect.arrayContaining(['curl-basic-auth', 'curl-multipart-form'])
    );
  });

  it('preserves URL even with -o /path/to/output', () => {
    const { preview } = expectPreview(
      'curl -o /tmp/out.json https://api.example.com/items'
    );
    expect(preview.original.url).toBe('https://api.example.com/items');
    expect(preview.warnings).toContain('curl-output-file');
  });

  it('emits curl-multipart-form warning for -F', () => {
    const { preview } = expectPreview(
      'curl -F file=@photo.jpg https://api.example.com/upload'
    );
    expect(preview.warnings).toContain('curl-multipart-form');
  });

  it('emits curl-cookie-jar warning for -b', () => {
    const { preview } = expectPreview(
      'curl -b "session=abc" https://api.example.com'
    );
    expect(preview.warnings).toContain('curl-cookie-jar');
  });

  it('emits curl-data-binary-file warning for --data-binary @file', () => {
    const { preview } = expectPreview(
      'curl --data-binary @payload.bin https://api.example.com'
    );
    expect(preview.warnings).toContain('curl-data-binary-file');
    expect(preview.original.body).toBeUndefined();
  });

  it('imports --data-binary inline text as a regular text body', () => {
    const { preview } = expectPreview(
      'curl --data-binary "literal text" https://api.example.com'
    );
    expect(preview.warnings).not.toContain('curl-data-binary-file');
    expect(preview.original.method).toBe('POST');
    expect(preview.original.body).toEqual({
      kind: 'text',
      content: 'literal text',
    });
  });

  it('imports --data-binary=value inline text as a regular text body', () => {
    const { preview } = expectPreview(
      'curl --data-binary=literal https://api.example.com'
    );
    expect(preview.warnings).not.toContain('curl-data-binary-file');
    expect(preview.original.body).toEqual({
      kind: 'text',
      content: 'literal',
    });
  });

  it('preserves an explicitly empty data body without stealing the URL', () => {
    const { preview } = expectPreview(`curl -d '' https://api.example.com/empty`);
    expect(preview.original.method).toBe('POST');
    expect(preview.original.url).toBe('https://api.example.com/empty');
    expect(preview.original.body).toEqual({ kind: 'text', content: '' });
  });

  it('emits lossy warnings for long flags with inline values', () => {
    const { preview } = expectPreview(
      'curl --user=admin:hunter2 --output=/tmp/out.json --data-binary=@payload.bin https://api.example.com'
    );
    expect(preview.original.url).toBe('https://api.example.com');
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        'curl-basic-auth',
        'curl-output-file',
        'curl-data-binary-file',
      ])
    );
  });

  it('emits curl-output-file warning for -o', () => {
    const { preview } = expectPreview(
      'curl -o /tmp/out.json https://api.example.com'
    );
    expect(preview.warnings).toContain('curl-output-file');
  });
});

describe('curlImporterAdapter.import', () => {
  it('round-trips the ORIGINAL (un-redacted) values on confirm', () => {
    const { preview } = expectPreview(
      'curl -H "Authorization: Bearer secret-token" https://api.example.com/me'
    );
    const result = curlImporterAdapter.import(preview);
    const auth = result.headers.find(
      (h) => h.name.toLowerCase() === 'authorization'
    );
    expect(auth?.value).toBe('Bearer secret-token');
  });

  it('preserves method, URL, and body kind', () => {
    const { preview } = expectPreview(
      'curl -X POST --json \'{"a":1}\' https://api.example.com/items'
    );
    const result = curlImporterAdapter.import(preview);
    expect(result.method).toBe('POST');
    expect(result.url).toBe('https://api.example.com/items');
    expect(result.body?.kind).toBe('json');
    expect(result.body?.content).toBe('{"a":1}');
  });
});

describe('adapter contract surface', () => {
  it('declares the closed id + i18n keys', () => {
    expect(curlImporterAdapter.id).toBe('curl-http');
    expect(curlImporterAdapter.titleKey).toBe(
      'importPreview.importer.curlHttp.title'
    );
    expect(curlImporterAdapter.descriptionKey).toBe(
      'importPreview.importer.curlHttp.description'
    );
  });
});
