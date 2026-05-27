/**
 * RL-097 Slice 1 fold B — cURL paste parser.
 *
 * Pinned coverage: the 80% case (browser + Postman copy-as-curl
 * shapes). Failure modes are documented in `curlImport.ts`.
 */

import { describe, expect, it } from 'vitest';
import { tryParseCurl } from '../../../src/renderer/components/HttpWorkspace/curlImport';

describe('tryParseCurl (RL-097 Slice 1 fold B)', () => {
  it('returns null on non-curl input', () => {
    expect(tryParseCurl('not a curl command')).toBeNull();
    expect(tryParseCurl('')).toBeNull();
  });

  it('parses the minimal curl URL', () => {
    const parsed = tryParseCurl('curl https://example.com/');
    expect(parsed).toEqual({
      method: 'GET',
      url: 'https://example.com/',
      headers: [],
    });
  });

  it('parses -X METHOD', () => {
    const parsed = tryParseCurl(
      `curl -X DELETE https://example.com/users/1`
    );
    expect(parsed?.method).toBe('DELETE');
    expect(parsed?.url).toBe('https://example.com/users/1');
  });

  it('parses single -H header with single quotes', () => {
    const parsed = tryParseCurl(
      `curl -H 'Authorization: Bearer xyz' https://example.com/`
    );
    expect(parsed?.headers).toEqual([
      { name: 'Authorization', value: 'Bearer xyz', enabled: true },
    ]);
  });

  it('parses multiple -H headers', () => {
    const parsed = tryParseCurl(
      `curl -H 'Accept: application/json' -H 'X-Custom: 1' https://example.com/`
    );
    expect(parsed?.headers).toHaveLength(2);
  });

  it('parses -d with JSON body and infers JSON kind', () => {
    const parsed = tryParseCurl(
      `curl -X POST -H 'Content-Type: application/json' -d '{"a":1}' https://example.com/`
    );
    expect(parsed?.method).toBe('POST');
    expect(parsed?.body?.kind).toBe('json');
    expect(parsed?.body?.content).toBe('{"a":1}');
  });

  it('parses --json shorthand (implies POST + JSON content-type)', () => {
    const parsed = tryParseCurl(
      `curl --json '{"a":1}' https://example.com/`
    );
    expect(parsed?.method).toBe('POST');
    expect(parsed?.body?.kind).toBe('json');
    expect(
      parsed?.headers.find((h) => h.name.toLowerCase() === 'content-type')
        ?.value
    ).toBe('application/json');
  });

  it('handles backslash line continuations', () => {
    const parsed = tryParseCurl(
      `curl -X POST \\\n  -H 'X-A: a' \\\n  https://example.com/`
    );
    expect(parsed?.method).toBe('POST');
    expect(parsed?.headers).toEqual([
      { name: 'X-A', value: 'a', enabled: true },
    ]);
  });

  it('handles double-quoted strings with embedded spaces', () => {
    const parsed = tryParseCurl(
      `curl -H "X-Note: hello world" https://example.com/`
    );
    expect(parsed?.headers[0]?.value).toBe('hello world');
  });

  it('defaults method to POST when a body is present and no -X given', () => {
    const parsed = tryParseCurl(`curl -d 'raw=text' https://example.com/`);
    expect(parsed?.method).toBe('POST');
    expect(parsed?.body?.kind).toBe('text');
  });

  it('parses --data-binary text payloads without treating them as file uploads', () => {
    const parsed = tryParseCurl(
      `curl --data-binary 'raw payload' https://example.com/upload`
    );
    expect(parsed?.method).toBe('POST');
    expect(parsed?.url).toBe('https://example.com/upload');
    expect(parsed?.body).toEqual({ kind: 'text', content: 'raw payload' });
  });

  it('preserves explicitly empty quoted data payloads', () => {
    const parsed = tryParseCurl(`curl -d '' https://example.com/empty`);
    expect(parsed?.method).toBe('POST');
    expect(parsed?.url).toBe('https://example.com/empty');
    expect(parsed?.body).toEqual({ kind: 'text', content: '' });
  });
});
