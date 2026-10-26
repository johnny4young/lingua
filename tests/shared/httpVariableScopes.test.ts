import { describe, expect, it } from 'vitest';
import {
  collectSecretResolvedValues,
  createBlankHttpEnvironment,
  createEnvVariable,
  environmentColor,
  findUnresolvedVariables,
  interpolateRequest,
  layeredEnvironment,
  maskSecretsForCapsule,
  parseHttpEnvironment,
  variableSources,
  type HttpEnvironmentV1,
  type HttpVariableLayers,
} from '../../src/shared/httpEnvironment';
import { createBlankHttpRequest, parseHttpRequest } from '../../src/shared/httpWorkspace';

const NOW = '2026-10-25T00:00:00.000Z';
const row = (key: string, value: string, secret = false) => createEnvVariable({ key, value, secret });
const env = (name: string, variables = [row('base', 'https://env.example')]): HttpEnvironmentV1 => ({
  ...createBlankHttpEnvironment({ id: `env-${name}`, name, now: NOW }),
  variables,
});
const request = (url: string) => ({ ...createBlankHttpRequest({ id: 'r1', now: NOW }), url });

describe('variable scopes', () => {
  const layers: HttpVariableLayers = {
    collection: [row('base', 'https://collection.example'), row('owner', 'octocat'), row('token', 'coll-secret', true)],
    environment: env('staging', [row('base', 'https://staging.example'), row('repo', 'lingua')]),
    request: [row('repo', 'other-repo')],
  };

  it('resolves request over environment over collection', () => {
    const outbound = interpolateRequest(request('{{base}}/repos/{{owner}}/{{repo}}'), layeredEnvironment(layers));
    expect(outbound.url).toBe('https://staging.example/repos/octocat/other-repo');
  });

  it('says which scope supplies each key and which lower scopes it overrides', () => {
    const sources = variableSources(layers);
    expect(sources.get('base')).toEqual({ scope: 'environment', secret: false, overrides: ['collection'] });
    expect(sources.get('owner')).toEqual({ scope: 'collection', secret: false, overrides: [] });
    expect(sources.get('repo')).toEqual({ scope: 'request', secret: false, overrides: ['environment'] });
    expect(sources.get('token')).toMatchObject({ scope: 'collection', secret: true });
  });

  it('returns the environment untouched when the other scopes are empty, and a view without one', () => {
    const staging = env('staging');
    expect(layeredEnvironment({ collection: [], environment: staging, request: [] })).toBe(staging);
    expect(layeredEnvironment({ collection: [], environment: null, request: [] })).toBeNull();
    const onlyCollection = layeredEnvironment({ collection: [row('owner', 'octocat')], environment: null, request: [] });
    expect(findUnresolvedVariables(request('https://x/{{owner}}'), onlyCollection)).toEqual([]);
  });

  it('keeps a secret from any scope masked and collected for response scrubbing', () => {
    const scoped = layeredEnvironment({ ...layers, request: [row('reqToken', 'req-secret', true)] });
    const draft = { ...request('https://x/{{token}}/{{reqToken}}'), variables: [row('reqToken', 'req-secret', true)] };
    const masked = maskSecretsForCapsule(draft, scoped);
    expect(masked.url).toBe('https://x/{{token}}/{{reqToken}}');
    expect(masked.variables?.[0]?.value).toBe('');
    expect(JSON.stringify(masked)).not.toContain('secret-');
    expect(collectSecretResolvedValues(scoped)).toEqual(expect.arrayContaining(['coll-secret', 'req-secret']));
  });
});

describe('environment colour', () => {
  it('uses the chosen colour, else red for a production-looking name', () => {
    expect(environmentColor({ ...env('dev'), color: 'blue' })).toBe('blue');
    expect(environmentColor(env('prod'))).toBe('red');
    expect(environmentColor(env('Production EU'))).toBe('red');
    expect(environmentColor(env('product-demo'))).toBeUndefined();
    expect(environmentColor({ ...env('prod'), color: 'none' })).toBeUndefined();
    expect(environmentColor(null)).toBeUndefined();
  });

  it('keeps a known colour through parsing and drops an unknown one', () => {
    const raw = { ...env('dev'), color: 'green' };
    expect(parseHttpEnvironment(raw)?.color).toBe('green');
    expect(parseHttpEnvironment({ ...raw, color: 'pink' })).not.toHaveProperty('color');
    expect(parseHttpEnvironment({ ...raw, color: 'none' })?.color).toBe('none');
  });
});

describe('request variables persistence', () => {
  it('keeps valid rows, drops invalid ones and backfills ids', () => {
    const parsed = parseHttpRequest({
      ...request('https://x'),
      variables: [{ key: 'repo', value: 'lingua' }, { key: '', value: 'x' }, 'bad', { id: 'v1', key: 'token', value: 't', secret: true }],
    });
    expect(parsed?.variables).toEqual([
      { id: expect.any(String), key: 'repo', value: 'lingua', secret: false },
      { id: 'v1', key: 'token', value: 't', secret: true },
    ]);
    expect(parseHttpRequest(request('https://x'))).not.toHaveProperty('variables');
  });
});
