/**
 * HTTP workspace usability upgrade — pure builder helpers.
 *
 * Covers the three load-bearing behaviors the new request builder
 * relies on:
 *
 *   - `urlToParams` / `paramsToUrl` round-trip + two-way sync.
 *   - `buildAuthHeader` / `composeRequestHeaders` auth injection.
 *   - `buildCurlCommand` copy-as-cURL output.
 *
 * Plus back-compat: `parseHttpRequest` still accepts a request with no
 * `queryParams` / `auth` fields, and accepts the new fields when present.
 */

import { describe, expect, it } from 'vitest';
import {
  buildAuthHeader,
  buildCurlCommand,
  composeRequestHeaders,
  createBlankHttpRequest,
  DEFAULT_API_KEY_HEADER,
  paramsToUrl,
  parseHttpRequest,
  urlToParams,
  type HttpRequestV1,
} from '../../src/shared/httpWorkspace';
import {
  maskSecretsForCapsule,
  type HttpEnvironmentV1,
  type HttpEnvVariableV1,
} from '../../src/shared/httpEnvironment';

function makeRequest(overrides: Partial<HttpRequestV1> = {}): HttpRequestV1 {
  return {
    ...createBlankHttpRequest({ id: 'r1', now: '2026-05-29T00:00:00.000Z' }),
    method: 'GET',
    url: 'https://api.example.com/users',
    ...overrides,
  };
}

function env(
  variables: Array<Omit<HttpEnvVariableV1, 'id'>>
): HttpEnvironmentV1 {
  return {
    version: 1,
    id: 'e1',
    name: 'Dev',
    // RL-097 Slice 3b added the opaque `id`; stamp a synthetic one per row.
    variables: variables.map((row, i) => ({ id: `v${i}`, ...row })),
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z',
  };
}

describe('urlToParams / paramsToUrl — two-way sync', () => {
  it('derives enabled rows from a URL query string', () => {
    expect(urlToParams('https://x.dev/s?q=hello&page=2')).toEqual([
      { key: 'q', value: 'hello', enabled: true },
      { key: 'page', value: '2', enabled: true },
    ]);
  });

  it('returns no rows when the URL has no query string', () => {
    expect(urlToParams('https://x.dev/users')).toEqual([]);
    expect(urlToParams('not a url yet')).toEqual([]);
  });

  it('decodes percent-escapes and + as space like URLSearchParams', () => {
    expect(urlToParams('https://x.dev?q=a+b&t=%E2%9C%93')).toEqual([
      { key: 'q', value: 'a b', enabled: true },
      { key: 't', value: '✓', enabled: true },
    ]);
  });

  it('rebuilds the URL from enabled rows, dropping disabled + empty-key rows', () => {
    const url = paramsToUrl('https://x.dev/s?stale=1', [
      { key: 'q', value: 'hi', enabled: true },
      { key: 'skip', value: 'x', enabled: false },
      { key: '', value: 'orphan', enabled: true },
      { key: 'page', value: '2', enabled: true },
    ]);
    expect(url).toBe('https://x.dev/s?q=hi&page=2');
  });

  it('drops the query string entirely when no enabled rows remain', () => {
    expect(
      paramsToUrl('https://x.dev/s?q=old', [
        { key: 'q', value: 'old', enabled: false },
      ])
    ).toBe('https://x.dev/s');
  });

  it('preserves a trailing #fragment across a rebuild', () => {
    expect(
      paramsToUrl('https://x.dev/s?q=old#section', [
        { key: 'q', value: 'new', enabled: true },
      ])
    ).toBe('https://x.dev/s?q=new#section');
  });

  it('round-trips params -> url -> params', () => {
    const params = urlToParams('https://x.dev/s?a=1&b=two');
    const url = paramsToUrl('https://x.dev/s', params);
    expect(urlToParams(url)).toEqual(params);
  });
});

describe('buildAuthHeader — auth injection', () => {
  it('returns null for none / undefined / incomplete config', () => {
    expect(buildAuthHeader(undefined)).toBeNull();
    expect(buildAuthHeader({ kind: 'none' })).toBeNull();
    expect(buildAuthHeader({ kind: 'bearer', token: '' })).toBeNull();
    expect(buildAuthHeader({ kind: 'basic', username: '', password: '' })).toBeNull();
    expect(buildAuthHeader({ kind: 'apiKey', apiKeyValue: '' })).toBeNull();
  });

  it('injects a Bearer Authorization header', () => {
    expect(buildAuthHeader({ kind: 'bearer', token: 'abc123' })).toEqual({
      name: 'Authorization',
      value: 'Bearer abc123',
    });
  });

  it('injects a base64 Basic Authorization header (UTF-8 safe)', () => {
    const header = buildAuthHeader({
      kind: 'basic',
      username: 'aladdin',
      password: 'open sesame',
    });
    expect(header?.name).toBe('Authorization');
    // base64("aladdin:open sesame")
    expect(header?.value).toBe('Basic YWxhZGRpbjpvcGVuIHNlc2FtZQ==');
  });

  it('injects an API-key header, defaulting the name when blank', () => {
    expect(
      buildAuthHeader({ kind: 'apiKey', apiKeyValue: 'k3y' })
    ).toEqual({ name: DEFAULT_API_KEY_HEADER, value: 'k3y' });
    expect(
      buildAuthHeader({ kind: 'apiKey', apiKeyHeader: 'X-Token', apiKeyValue: 'k3y' })
    ).toEqual({ name: 'X-Token', value: 'k3y' });
  });
});

describe('composeRequestHeaders — auth wins, disabled rows drop', () => {
  it('appends the injected auth header alongside enabled manual rows', () => {
    const request = makeRequest({
      headers: [
        { name: 'Accept', value: 'application/json', enabled: true },
        { name: 'X-Skip', value: 'no', enabled: false },
        { name: '', value: 'orphan', enabled: true },
      ],
      auth: { kind: 'bearer', token: 'tok' },
    });
    expect(composeRequestHeaders(request)).toEqual([
      { name: 'Accept', value: 'application/json' },
      { name: 'Authorization', value: 'Bearer tok' },
    ]);
  });

  it('lets the Auth sub-tab override a same-named manual Authorization row', () => {
    const request = makeRequest({
      headers: [
        { name: 'authorization', value: 'Bearer stale', enabled: true },
      ],
      auth: { kind: 'bearer', token: 'fresh' },
    });
    expect(composeRequestHeaders(request)).toEqual([
      { name: 'Authorization', value: 'Bearer fresh' },
    ]);
  });
});

describe('buildCurlCommand — copy as cURL', () => {
  it('builds a GET curl with no -X and quoted URL', () => {
    expect(buildCurlCommand(makeRequest())).toBe(
      "curl 'https://api.example.com/users'"
    );
  });

  it('emits -X, headers (incl. injected auth), and --data for a POST', () => {
    const request = makeRequest({
      method: 'POST',
      url: 'https://api.example.com/users?dry=1',
      headers: [{ name: 'Content-Type', value: 'application/json', enabled: true }],
      auth: { kind: 'bearer', token: 'tok' },
      body: { kind: 'json', content: '{"name":"ada"}' },
    });
    expect(buildCurlCommand(request)).toBe(
      "curl -X POST 'https://api.example.com/users?dry=1' " +
        "-H 'Content-Type: application/json' " +
        "-H 'Authorization: Bearer tok' " +
        `--data '{"name":"ada"}'`
    );
  });

  it('injects the runtime default Content-Type when the user set none (wire fidelity)', () => {
    const request = makeRequest({
      method: 'POST',
      url: 'https://api.example.com/users',
      body: { kind: 'json', content: '{"name":"ada"}' },
    });
    // Mirrors the runtime, which auto-adds application/json for a JSON
    // body. Without this the copied command would default to
    // x-www-form-urlencoded and diverge from the bytes actually sent.
    expect(buildCurlCommand(request)).toBe(
      "curl -X POST 'https://api.example.com/users' " +
        "-H 'Content-Type: application/json' " +
        `--data '{"name":"ada"}'`
    );
  });

  it('does not override an explicit Content-Type row with the default', () => {
    const request = makeRequest({
      method: 'POST',
      url: 'https://api.example.com/users',
      headers: [
        { name: 'content-type', value: 'application/vnd.api+json', enabled: true },
      ],
      body: { kind: 'json', content: '{}' },
    });
    const command = buildCurlCommand(request);
    expect(command).toContain(`-H 'content-type: application/vnd.api+json'`);
    expect(command).not.toContain('application/json');
  });

  it('shell-escapes embedded single quotes in values', () => {
    const request = makeRequest({
      method: 'POST',
      headers: [{ name: 'X-Note', value: "it's fine", enabled: true }],
      body: { kind: 'text', content: "o'clock" },
    });
    const command = buildCurlCommand(request);
    expect(command).toContain(`-H 'X-Note: it'\\''s fine'`);
    expect(command).toContain(`--data 'o'\\''clock'`);
  });

  it('omits the body for a GET even when one is set', () => {
    const request = makeRequest({
      method: 'GET',
      body: { kind: 'json', content: '{"x":1}' },
    });
    expect(buildCurlCommand(request)).toBe(
      "curl 'https://api.example.com/users'"
    );
  });

  // RL-097 Slice 3a fold B — secret-safe cURL. When an environment is
  // active, callers pre-mask via `maskSecretsForCapsule` so non-secret
  // vars resolve (runnable) and secret vars stay `{{key}}` (no leak).
  it('with a masked request, non-secret vars resolve and secret vars stay {{key}} (fold B)', () => {
    const request = makeRequest({
      method: 'POST',
      url: 'https://{{host}}/users',
      headers: [
        { name: 'Authorization', value: 'Bearer {{token}}', enabled: true },
      ],
      body: { kind: 'json', content: '{"h":"{{host}}"}' },
    });
    const masked = maskSecretsForCapsule(
      request,
      env([
        { key: 'host', value: 'api.example.com', secret: false },
        { key: 'token', value: 'sk-live-DONOTLEAK', secret: true },
      ])
    );
    const command = buildCurlCommand(masked);
    expect(command).toContain("'https://api.example.com/users'");
    expect(command).toContain("-H 'Authorization: Bearer {{token}}'");
    expect(command).not.toContain('sk-live-DONOTLEAK');
  });
});

describe('parseHttpRequest — back-compat for queryParams / auth', () => {
  it('accepts a request with no queryParams / auth (pre-feature shape)', () => {
    const raw = {
      version: 1,
      id: 'r1',
      name: 'old',
      method: 'GET',
      url: 'https://x.dev?a=1',
      headers: [],
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    const parsed = parseHttpRequest(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.queryParams).toBeUndefined();
    expect(parsed?.auth).toBeUndefined();
  });

  it('round-trips queryParams + auth when present', () => {
    const raw = {
      version: 1,
      id: 'r1',
      name: 'new',
      method: 'POST',
      url: 'https://x.dev?a=1',
      headers: [],
      queryParams: [{ key: 'a', value: '1', enabled: true }],
      auth: { kind: 'bearer', token: 'tok' },
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    const parsed = parseHttpRequest(raw);
    expect(parsed?.queryParams).toEqual([{ key: 'a', value: '1', enabled: true }]);
    expect(parsed?.auth).toEqual({ kind: 'bearer', token: 'tok' });
  });

  it('rejects a request with a malformed queryParams entry', () => {
    const raw = {
      version: 1,
      id: 'r1',
      name: 'bad',
      method: 'GET',
      url: 'https://x.dev',
      headers: [],
      queryParams: [{ key: 'a' }], // missing value + enabled
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    expect(parseHttpRequest(raw)).toBeNull();
  });

  it('rejects a request with an invalid auth kind', () => {
    const raw = {
      version: 1,
      id: 'r1',
      name: 'bad',
      method: 'GET',
      url: 'https://x.dev',
      headers: [],
      auth: { kind: 'oauth2' },
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    expect(parseHttpRequest(raw)).toBeNull();
  });
});
