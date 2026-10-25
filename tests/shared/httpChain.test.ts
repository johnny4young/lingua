import { describe, expect, it } from 'vitest';
import { capturersOf, chainedOrigin, chainOrder, chainPasses, chainRows, chainTags, chainValue, latestFor, requestLabel, sourceNeedsSend } from '../../src/shared/httpChain';
import { httpUrlState, layeredEnvironment, referencedVariables } from '../../src/shared/httpEnvironment';
import { createBlankHttpRequest, parseHttpRequest, parseHttpResponse, type HttpRequestV1, type HttpResponseV1 } from '../../src/shared/httpWorkspace';

const NOW = '2026-10-25T00:00:00.000Z';
const capture = (id: string, path: string, targetVariable: string, enabled = true) => ({ id, source: 'body-json' as const, path, targetVariable, enabled });
const request = (id: string, url: string, extra: Partial<HttpRequestV1> = {}): HttpRequestV1 => ({
  ...createBlankHttpRequest({ id, now: NOW }),
  name: id,
  url,
  ...extra,
});
const response = (body: unknown, extra: Partial<HttpResponseV1> = {}): HttpResponseV1 => ({
  version: 1,
  kind: 'success',
  status: 200,
  statusText: 'OK',
  url: 'https://api.example.com',
  finalUrl: 'https://api.example.com',
  headers: [],
  body: JSON.stringify(body),
  contentType: 'application/json',
  sizeBytes: 10,
  durationMs: 12,
  tooLarge: false,
  redactedHeaders: [],
  recordedAt: NOW,
  ...extra,
});

const listRepos = request('list', 'https://api.example.com/users/octocat/repos', { captures: [capture('c1', '[0].owner.login', 'owner')] });
const getRepo = request('get', 'https://api.example.com/repos/{{owner}}/{{repo}}', { captures: [capture('c2', 'issues_url', 'issues')] });
const listIssues = request('issues', '{{issues}}?state=open');

describe('chain tags', () => {
  it('are the variables another request captures, first producer winning, never its own', () => {
    const duplicate = request('dup', 'https://x', { captures: [capture('c3', 'login', 'owner')] });
    const self = request('self', 'https://x/{{mine}}', { captures: [capture('c4', 'id', 'mine')] });
    const off = request('off', 'https://x', { captures: [capture('c5', 'id', 'repo', false)] });
    const requests = [listRepos, duplicate, getRepo, self, off];
    expect(chainTags(getRepo, requests)).toEqual([{ key: 'owner', sourceId: 'list', capture: listRepos.captures![0], rule: 'last' }]);
    expect(chainTags(self, requests)).toEqual([]);
    expect(chainTags({ ...getRepo, chainRules: { owner: 'stale' } }, requests)[0]?.rule).toBe('stale');
  });

  it('read a value only from a 2xx response', () => {
    const [tag] = chainTags(getRepo, [listRepos, getRepo]);
    const body = [{ owner: { login: 'octocat' } }];
    expect(chainValue(tag!, response(body))).toBe('octocat');
    expect(chainValue(tag!, response(body, { status: 301 }))).toBeNull();
    expect(chainValue(tag!, response(body, { kind: 'server-error', status: 500 }))).toBeNull();
    expect(chainValue(tag!, undefined)).toBeNull();
    expect(chainPasses(response(body, { status: 299 }))).toBe(true);
    expect(chainPasses(response(body, { kind: 'network-error', status: 0 }))).toBe(false);
  });

  it('read only a response recorded under the active environment', () => {
    const staging = response([], { environmentId: 'stg' });
    const none = response([]);
    expect(latestFor({ list: [staging] }, 'list', 'stg')).toBe(staging);
    expect(latestFor({ list: [staging] }, 'list', 'prod')).toBeUndefined();
    expect(latestFor({ list: [staging] }, 'list', null)).toBeUndefined();
    expect(latestFor({ list: [none] }, 'list', null)).toBe(none);
  });

  it('never read a redacted placeholder as a value', () => {
    const [tag] = chainTags(getRepo, [listRepos, getRepo]);
    expect(chainValue(tag!, response([{ owner: { login: 'a <redacted> b' } }]))).toBeNull();
    const header = { ...tag!, capture: { id: 'h', source: 'header' as const, path: 'Set-Cookie', targetVariable: 'owner', enabled: true } };
    const withCookie = response([], { headers: [{ name: 'set-cookie', value: '<redacted>', redacted: true }], redactedHeaders: ['set-cookie'] });
    expect(chainValue(header, withCookie)).toBeNull();
  });

  it('ignore rules a request inherits instead of storing', () => {
    const producer = request('p', 'https://x', { captures: [capture('cc', 'id', 'constructor')] });
    const user = request('u', 'https://x/{{constructor}}', { chainRules: {} });
    expect(chainTags(user, [producer, user])[0]?.rule).toBe('last');
  });

  it('find when a just-captured value sets the scheme or host', () => {
    const env = { version: 1 as const, id: 'e', name: 'e', variables: [
      { id: '1', key: 'base', value: 'https://api.other.com', secret: false },
      { id: '2', key: 'host', value: 'evil.example', secret: false },
      { id: '3', key: 'id', value: '42', secret: false },
    ], createdAt: NOW, updatedAt: NOW };
    expect(chainedOrigin('{{base}}/items', env, new Set(['base']))).toBe('https://api.other.com');
    expect(chainedOrigin('https://{{host}}/x', env, new Set(['host']))).toBe('https://evil.example');
    expect(chainedOrigin('https://api.example.com/{{id}}', env, new Set(['id']))).toBeNull();
    expect(chainedOrigin('{{base}}/items', env, new Set(['id']))).toBeNull();
    expect(chainedOrigin('{{base}}/items', env, new Set())).toBeNull();
    expect(chainedOrigin('{{missing}}/items', env, new Set(['missing']))).toBeNull();
    // A fresh value that rewrites the authority from outside the host still counts.
    const authority = { ...env, variables: [...env.variables, { id: '4', key: 'suffix', value: '@evil.example', secret: false }] };
    expect(chainedOrigin('https://api.example.com{{suffix}}/x', authority, new Set(['suffix']))).toBe('https://evil.example');
    const scheme = { ...env, variables: [...env.variables, { id: '5', key: 'next', value: 'mailto:someone', secret: false }] };
    expect(chainedOrigin('{{next}}', scheme, new Set(['next']))).toBe('mailto:someone');
  });

  it('send their source first only when the rule says so', () => {
    const [tag] = chainTags(getRepo, [listRepos, getRepo]);
    const fresh = response([], { recordedAt: '2026-10-25T00:04:00.000Z' });
    const at = Date.parse('2026-10-25T00:06:00.000Z');
    expect(sourceNeedsSend({ ...tag!, rule: 'last' }, undefined, at)).toBe(false);
    expect(sourceNeedsSend({ ...tag!, rule: 'source-first' }, fresh, at)).toBe(true);
    expect(sourceNeedsSend({ ...tag!, rule: 'stale' }, fresh, at)).toBe(false);
    expect(sourceNeedsSend({ ...tag!, rule: 'stale' }, response([], { recordedAt: '2026-10-25T00:00:30.000Z' }), at)).toBe(true);
    expect(sourceNeedsSend({ ...tag!, rule: 'stale' }, response([], { status: 404, kind: 'client-error' }), at)).toBe(true);
  });

  it('order every source after the ones it depends on, and find a cycle', () => {
    const requests = [listIssues, getRepo, listRepos];
    expect(chainOrder('issues', requests)).toEqual({ order: ['list', 'get'], cycle: false, tooLong: false });
    expect(chainOrder('list', requests)).toEqual({ order: [], cycle: false, tooLong: false });
    const a = request('a', 'https://x/{{b}}', { captures: [capture('ca', 'id', 'a')] });
    const b = request('b', 'https://x/{{a}}', { captures: [capture('cb', 'id', 'b')] });
    expect(chainOrder('a', [a, b]).cycle).toBe(true);
    // A long chain without a cycle is too long, not circular.
    const long = Array.from({ length: 23 }, (_, i) =>
      request(`r${i}`, i === 22 ? 'https://x' : `https://x/{{v${i + 1}}}`, { captures: [capture(`c${i}`, 'id', `v${i}`)] })
    );
    expect(chainOrder('r0', long)).toMatchObject({ cycle: false, tooLong: true });
  });

  it('name every request that captures a variable', () => {
    const second = request('second', 'https://x', { name: '', captures: [capture('c9', 'id', 'owner')] });
    expect(capturersOf('owner', [listRepos, getRepo, second]).map(requestLabel)).toEqual(['list', 'https://x']);
  });

  it('give the chain layer its rows, secret when the key is secret elsewhere or looks like one', () => {
    const login = request('login', 'https://x', { captures: [capture('cl', 'token', 'accessToken'), capture('cu', 'user', 'user')] });
    const me = request('me', 'https://x/{{user}}?t={{accessToken}}&p={{plain}}', {});
    const plain = request('plain', 'https://x', { captures: [capture('cp', 'p', 'plain')] });
    const tags = chainTags(me, [login, me, plain]);
    const rows = chainRows(tags, (id) => (id === 'login' ? response({ token: 'abc', user: 'u1' }) : response({ p: 'v' })), new Set(['user']));
    expect(rows.map(({ key, value, secret }) => ({ key, value, secret }))).toEqual([
      { key: 'user', value: 'u1', secret: true },
      { key: 'accessToken', value: 'abc', secret: true },
      { key: 'plain', value: 'v', secret: false },
    ]);
  });

  it('sit between the environment and the request in precedence', () => {
    const env = { version: 1 as const, id: 'e', name: 'dev', variables: [{ id: 'e1', key: 'owner', value: 'env', secret: false }], createdAt: NOW, updatedAt: NOW };
    const chain = [{ id: 'k', key: 'owner', value: 'chain', secret: false }];
    expect(layeredEnvironment({ collection: [], environment: env, chain, request: [] })?.variables.at(-1)?.value).toBe('chain');
    const own = [{ id: 'r', key: 'owner', value: 'request', secret: false }];
    expect(layeredEnvironment({ collection: [], environment: env, chain, request: own })?.variables.at(-1)?.value).toBe('request');
  });
});

describe('variable scanning and persistence', () => {
  it('lists every referenced variable once, skipping disabled headers', () => {
    const req = request('r', '{{base}}/{{path}}', {
      headers: [
        { name: 'A', value: '{{token}} {{base}}', enabled: true },
        { name: 'B', value: '{{hidden}}', enabled: false },
      ],
      body: { kind: 'json', content: '{"q":"{{query}}"}' },
      method: 'POST',
    });
    expect(referencedVariables(req)).toEqual(['base', 'path', 'token', 'query']);
  });

  it('judges a URL only once its deferred tags have values', () => {
    expect(httpUrlState('{{issues}}?state=open', 'http', null)).toEqual({ ok: false, reason: 'unresolved', key: 'issues' });
    expect(httpUrlState('{{issues}}?state=open', 'http', null, new Set(['issues']))).toEqual({ ok: true });
    expect(httpUrlState('{{issues}}/{{other}}', 'http', null, new Set(['issues']))).toEqual({ ok: false, reason: 'unresolved', key: 'other' });
  });

  it('keeps the environment a response was recorded under', () => {
    expect(parseHttpResponse({ ...response([]), environmentId: 'prod' })?.environmentId).toBe('prod');
    expect(parseHttpResponse({ ...response([]), environmentId: 42 })).not.toHaveProperty('environmentId');
  });

  it('keeps known chain rules and drops the rest', () => {
    const parsed = parseHttpRequest({ ...request('r', 'https://x'), chainRules: { owner: 'source-first', repo: 'stale', bad: 'never', '': 'last' } });
    expect(parsed?.chainRules).toEqual({ owner: 'source-first', repo: 'stale' });
    expect(parseHttpRequest(request('r', 'https://x'))).not.toHaveProperty('chainRules');
  });
});
