import { describe, expect, it, vi } from 'vitest';
import { buildHttpJsTab } from '../../src/shared/httpJsTab';
import type { HttpRequestV1 } from '../../src/shared/httpWorkspaceSchema';

const request = (patch: Partial<HttpRequestV1>): HttpRequestV1 =>
  ({ id: 'r', name: 'r', method: 'GET', url: 'https://api.test/x', headers: [], ...patch }) as HttpRequestV1;
const build = (patch: Partial<HttpRequestV1>, sensitiveHeaders: string[] = []) =>
  buildHttpJsTab(request(patch), { sensitiveHeaders, fillInComment: 'Fill these in.' });
const header = (name: string, value: string, enabled = true) => ({ id: name, name, value, enabled });

/** Runs the tab with the placeholders filled in, returning what fetch received. */
async function run(source: string, values: Record<string, string> = {}) {
  const fetchMock = vi.fn(async (..._args: [string, RequestInit]) => ({ status: 200, text: async () => 'ok' }));
  const log = vi.fn();
  let filled = source;
  for (const [key, value] of Object.entries(values)) filled = filled.replace(JSON.stringify(`{{${key}}}`), JSON.stringify(value));
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<void>;
  await new AsyncFunction('fetch', 'console', filled)(fetchMock, { log });
  const [url, init] = fetchMock.mock.calls[0]!;
  return { url, init, log };
}

describe('buildHttpJsTab', () => {
  it('needs no vars when nothing is withheld, and logs the response', async () => {
    const source = build({ headers: [header('Accept', 'text/plain')] });
    expect(source).not.toContain('vars');
    const { url, init, log } = await run(source);
    expect(url).toBe('https://api.test/x');
    expect(init).toEqual({ method: 'GET', headers: { Accept: 'text/plain' } });
    expect(log).toHaveBeenCalledWith(200, 'ok');
  });

  it('turns each placeholder into a value to fill in at the top', async () => {
    const source = build({ url: 'https://{{host}}/x/{{id}}', headers: [header('X-Trace', '{{id}}-a')] });
    expect(source.split('\n').slice(0, 5)).toEqual(['// Fill these in.', 'const vars = {', '  "host": "{{host}}",', '  "id": "{{id}}",', '};']);
    const { url, init } = await run(source, { host: 'h.test', id: '7' });
    expect(url).toBe('https://h.test/x/7');
    expect(init.headers).toEqual({ 'X-Trace': '7-a' });
  });

  it('reads a key that is not an identifier', async () => {
    const { url } = await run(build({ url: 'https://h.test/{{api-key.v1}}' }), { 'api-key.v1': 'k' });
    expect(url).toBe('https://h.test/k');
  });

  it('keeps characters that mean something in a template as text', async () => {
    const body = { kind: 'text', content: '`${process.env.SECRET}` \\ "q"\n{{x}}' } as HttpRequestV1['body'];
    const { init } = await run(build({ method: 'POST', body }), { x: 'v' });
    expect(init.body).toBe('`${process.env.SECRET}` \\ "q"\nv');
  });

  it('cannot be broken out of by a hostile string', async () => {
    const url = 'https://h.test/"+globalThis.pwned=1+"`${globalThis.pwned=1}`';
    expect((await run(build({ url }))).url).toBe(url);
    const withVar = request({ url: 'https://h.test/{{x}}' });
    await run(buildHttpJsTab(withVar, { sensitiveHeaders: [], fillInComment: 'x\n globalThis.pwned=1' }), { x: 'v' });
    expect((globalThis as { pwned?: number }).pwned).toBeUndefined();
  });

  it.each([
    ['a bearer token', { auth: { kind: 'bearer', token: 'tok-SECRET' } }, 'token'],
    ['an API key', { auth: { kind: 'apiKey', apiKeyValue: 'key-SECRET' } }, 'api_key'],
    ['a basic password', { auth: { kind: 'basic', username: 'ana', password: 'pw-SECRET' } }, 'password'],
    ['a sensitive header', { headers: [header('Authorization', 'Bearer tok-SECRET')] }, 'authorization'],
    ['a credential in the URL', { url: 'https://h.test/x?api_key=SECRET&page=2' }, 'api_key'],
    ['a password in the authority', { url: 'https://ana:SECRET@h.test/x' }, 'url_credentials'],
  ] as const)('never writes %s to the file', (_name, patch, key) => {
    const source = build(patch as Partial<HttpRequestV1>);
    expect(source).not.toContain('SECRET');
    expect(source).toContain(`"${key}": "{{${key}}}"`);
  });

  it('withholds a header the user marked sensitive', () => {
    const source = build({ headers: [header('X-Internal', 'SECRET')] }, ['x-internal']);
    expect(source).not.toContain('SECRET');
    expect(build({ headers: [header('X-Internal', 'SECRET')] })).toContain('SECRET');
  });

  it('leaves a credential that is already a placeholder alone', async () => {
    const source = build({ auth: { kind: 'bearer', token: '{{apiToken}}' }, url: 'https://h.test/x?token={{t}}' });
    expect(source).toContain('"apiToken": "{{apiToken}}"');
    const { url, init } = await run(source, { apiToken: 'abc', t: 'u' });
    expect(url).toBe('https://h.test/x?token=u');
    expect(init.headers).toEqual({ Authorization: 'Bearer abc' });
  });

  it('keeps the scheme word in front of a placeholder', async () => {
    const source = build({ headers: [header('Authorization', 'Bearer {{t}}')] });
    expect(source).not.toContain('"authorization": ');
    const { init } = await run(source, { t: 'abc' });
    expect(init.headers).toEqual({ Authorization: 'Bearer abc' });
  });

  it('keeps a harmless query parameter and an undecodable name', () => {
    expect(build({ url: 'https://h.test/x?page=2&%zz=1' })).toContain('"https://h.test/x?page=2&%zz=1"');
  });

  it('encodes basic auth when it runs, from the filled-in values', async () => {
    const source = build({ auth: { kind: 'basic', username: 'ana', password: '{{pw}}' } });
    expect(source).not.toMatch(/Basic [A-Za-z0-9+/=]{4,}/);
    const { init } = await run(source, { pw: 'ñandú' });
    const decoded = new TextDecoder().decode(Uint8Array.from(atob((init.headers as Record<string, string>)['Authorization']!.replace('Basic ', '')), (c) => c.charCodeAt(0)));
    expect(decoded).toBe('ana:ñandú');
  });

  it('sends a body and its default content type like a Send does', async () => {
    const body = { kind: 'json', content: '{"a":1}' } as HttpRequestV1['body'];
    const { init } = await run(build({ method: 'POST', body }));
    expect(init).toEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
  });
});
