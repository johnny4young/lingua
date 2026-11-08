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
    ['a bearer token', { auth: { kind: 'bearer', token: 'tok-SECRET' } }, 'auth_token'],
    ['an API key', { auth: { kind: 'apiKey', apiKeyValue: 'key-SECRET' } }, 'auth_api_key'],
    ['a basic password', { auth: { kind: 'basic', username: '{{user}}', password: 'pw-SECRET' } }, 'auth_password'],
    ['a sensitive header', { headers: [header('Authorization', 'Bearer tok-SECRET')] }, 'header_authorization'],
    ['a credential in the URL', { url: 'https://h.test/x?api_key=SECRET&page=2' }, 'param_api_key'],
    ['a bare key in the URL', { url: 'https://h.test/x?key=SECRET' }, 'param_key'],
    ['a signature in the URL', { url: 'https://h.test/x?a=1&X-Amz-Signature=SECRET' }, 'param_x_amz_signature'],
    ['a credential in the fragment', { url: 'https://h.test/cb#access_token=SECRET&state=1' }, 'param_access_token'],
    ['a credential after a semicolon', { url: 'https://h.test/x?a=1;token=SECRET' }, 'param_token'],
    ['a secret in a basic username', { auth: { kind: 'basic', username: 'sk_live_SECRET' } }, 'auth_username'],
    ['a password in the URL', { url: 'https://ana:SECRET@h.test/x' }, 'auth_password'],
    ['a password with an @ in the URL', { url: 'https://ana:p@ss-SECRET@h.test/x' }, 'auth_password'],
    ['a key in the URL username', { url: 'https://SECRET@h.test/x' }, 'auth_username'],
    ['a header named like a credential', { headers: [header('X-Custom-Token', 'SECRET')] }, 'header_x_custom_token'],
    ['an Azure api-key header', { headers: [header('api-key', 'SECRET')] }, 'header_api_key'],
    ['a leading space before URL credentials', { url: ' https://ana:SECRET@h.test/x' }, 'auth_password'],
    ['URL credentials after backslashes', { url: 'https:\\\\ana:SECRET@h.test/x' }, 'auth_password'],
    ['URL credentials after one slash', { url: 'https:/ana:SECRET@h.test/x' }, 'auth_password'],
    ['a tab inside the scheme', { url: 'ht\ttps://ana:SECRET@h.test/x' }, 'auth_password'],
    ['URL credentials after a placeholder scheme', { url: '{{scheme}}://ana:SECRET@h.test/x' }, 'auth_password'],
    ['an authorization parameter', { url: 'https://h.test/x?authorization=SECRET' }, 'param_authorization'],
    ['a pass parameter', { url: 'https://h.test/x?pass=SECRET' }, 'param_pass'],
    ['an app_key parameter', { url: 'https://h.test/x?app_key=SECRET' }, 'param_app_key'],
    ['a code parameter', { url: 'https://h.test/x?code=SECRET' }, 'param_code'],
    ['a name with a plus', { url: 'https://h.test/x?api+key=SECRET' }, 'param_api_key'],
    ['a name that cannot be decoded', { url: 'https://h.test/x?to%6Ben%zz=SECRET' }, 'param_to_6ben_zz'],
    ['a name that is a placeholder', { url: 'https://h.test/x?{{p}}=SECRET' }, 'param_p'],
    ['a credential nested in a value', { url: 'https://h.test/x?next=https://a.test/?token=SECRET' }, 'param_next'],
  ] as const)('never writes %s to the file', (_name, patch, key) => {
    const source = build(patch as Partial<HttpRequestV1>);
    expect(source).not.toContain('SECRET');
    expect(source).toContain(`"${key}": "{{${key}}}"`);
  });

  it('moves URL credentials to Basic auth, since fetch refuses them in the URL', async () => {
    const { url, init } = await run(build({ url: ' https://{{u}}:{{p}}@h.test/x?a=1' }), { u: 'ana', p: 'pw' });
    expect(url).toBe('https://h.test/x?a=1');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Basic ${btoa('ana:pw')}`);
  });

  it('lets configured auth win over URL credentials', async () => {
    const { url, init } = await run(build({ url: 'https://ana:SECRET@h.test/x', auth: { kind: 'bearer', token: '{{t}}' } }), { t: 'abc' });
    expect(url).toBe('https://h.test/x');
    expect(init.headers).toEqual({ Authorization: 'Bearer abc' });
  });

  it('keeps a hash directive in a URL inert', async () => {
    const source = build({ url: 'https://h.test/#@timeout 1ms' });
    expect(source).not.toMatch(/#\s*@/);
    expect((await run(source, {})).url).toBe('https://h.test/#@timeout 1ms');
  });

  it('keeps a value from reading as a directive or hiding behind bidi controls', async () => {
    const hostile = 'a //=> b // @timeout 999999 \u202Ec';
    const body = { kind: 'text', content: hostile } as HttpRequestV1['body'];
    const source = build({ method: 'POST', body });
    expect(source).not.toMatch(/\/\/\s*(?:=>|@)/);
    expect(source).not.toContain('\u202E');
    const { init } = await run(source);
    expect(init.body).toBe(hostile);
    const template = build({ url: 'https://h.test/{{x}}//=>' });
    expect(template).not.toContain('//=>');
    expect((await run(template, { x: 'v' })).url).toBe('https://h.test/v//=>');
  });

  it('keeps a withheld credential apart from a placeholder of the same name', async () => {
    const source = build({ auth: { kind: 'bearer', token: 'tok-SECRET' }, headers: [header('X-Trace', '{{token}}')] });
    expect(source).toContain('"auth_token": "{{auth_token}}"');
    expect(source).toContain('"token": "{{token}}"');
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
    const url = 'https://h.test/x?page=2&name=ana&path=/a&author=bo&file=f.txt&keyword=sql&utm_source=web#top';
    expect(build({ url })).toContain(JSON.stringify(url));
  });

  it('encodes basic auth when it runs, from the filled-in values', async () => {
    const source = build({ auth: { kind: 'basic', username: '{{user}}', password: '{{pw}}' } });
    expect(source).not.toMatch(/Basic [A-Za-z0-9+/=]{4,}/);
    const { init } = await run(source, { user: 'ana', pw: 'ñandú' });
    const decoded = new TextDecoder().decode(Uint8Array.from(atob((init.headers as Record<string, string>)['Authorization']!.replace('Basic ', '')), (c) => c.charCodeAt(0)));
    expect(decoded).toBe('ana:ñandú');
  });

  it('sends a body and its default content type like a Send does', async () => {
    const body = { kind: 'json', content: '{"a":1}' } as HttpRequestV1['body'];
    const { init } = await run(build({ method: 'POST', body }));
    expect(init).toEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
  });
});
