/**
 * RL-097 Slice 3a — exhaustive coverage of the HTTP environment engine.
 *
 * The privacy-critical functions (`maskSecretsForCapsule`,
 * `collectSecretResolvedValues`, `maskSecretValuesInResponse`) get the
 * heaviest coverage: a leaked secret is the worst failure mode for this
 * slice.
 */

import { describe, expect, it } from 'vitest';
import {
  collectSecretResolvedValues,
  createBlankHttpEnvironment,
  createEnvVariable,
  findResolvedVariables,
  findUnresolvedVariables,
  interpolateRequest,
  interpolateString,
  looksSecret,
  maskSecretsForCapsule,
  maskSecretValuesInResponse,
  parseHttpEnvironment,
  toExportableEnvironment,
  type HttpEnvironmentV1,
  type HttpEnvVariableV1,
} from '../../src/shared/httpEnvironment';
import {
  createBlankHttpRequest,
  type HttpRequestAuth,
  type HttpRequestV1,
  type HttpResponseV1,
} from '../../src/shared/httpWorkspace';

/**
 * Build a variable row from `{key, value, secret}` with a deterministic
 * opaque id (RL-097 Slice 3b added `HttpEnvVariableV1.id`). Tests assert on
 * key/value/secret semantics, not the opaque id, so a stable synthetic id
 * keeps the literals readable.
 */
function vars(
  rows: Array<Omit<HttpEnvVariableV1, 'id'>>
): HttpEnvVariableV1[] {
  return rows.map((row, i) => ({ id: `v${i}`, ...row }));
}

function env(
  variables: Array<Omit<HttpEnvVariableV1, 'id'>>,
  overrides: Partial<HttpEnvironmentV1> = {}
): HttpEnvironmentV1 {
  return {
    version: 1,
    id: 'env-1',
    name: 'Dev',
    variables: vars(variables),
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z',
    ...overrides,
  };
}

function req(overrides: Partial<HttpRequestV1> = {}): HttpRequestV1 {
  return {
    ...createBlankHttpRequest({ id: 'r1', now: '2026-06-16T00:00:00.000Z' }),
    method: 'GET',
    url: 'https://{{host}}/users',
    ...overrides,
  };
}

function resp(overrides: Partial<HttpResponseV1> = {}): HttpResponseV1 {
  return {
    version: 1,
    kind: 'success',
    status: 200,
    statusText: 'OK',
    url: 'https://api.example.com/users',
    finalUrl: 'https://api.example.com/users',
    headers: [],
    body: '',
    contentType: 'application/json',
    sizeBytes: 0,
    durationMs: 1,
    tooLarge: false,
    redactedHeaders: [],
    recordedAt: '2026-06-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('interpolateString', () => {
  it('replaces a known token with its value', () => {
    const lookup = new Map([['host', 'api.example.com']]);
    expect(interpolateString('https://{{host}}/x', lookup)).toBe(
      'https://api.example.com/x'
    );
  });

  it('tolerates inner whitespace around the key', () => {
    const lookup = new Map([['host', 'api.example.com']]);
    expect(interpolateString('https://{{  host  }}/x', lookup)).toBe(
      'https://api.example.com/x'
    );
  });

  it('leaves an unknown token verbatim', () => {
    const lookup = new Map([['host', 'api.example.com']]);
    expect(interpolateString('{{host}}/{{missing}}', lookup)).toBe(
      'api.example.com/{{missing}}'
    );
  });

  it('is single-pass: a value containing {{other}} is NOT recursively expanded', () => {
    const lookup = new Map([
      ['a', '{{b}}'],
      ['b', 'SHOULD_NOT_APPEAR'],
    ]);
    expect(interpolateString('{{a}}', lookup)).toBe('{{b}}');
  });

  it('does not loop on a self-referential value', () => {
    const lookup = new Map([['a', '{{a}}']]);
    expect(interpolateString('{{a}}', lookup)).toBe('{{a}}');
  });

  it('returns empty input unchanged', () => {
    expect(interpolateString('', new Map())).toBe('');
  });
});

describe('interpolateRequest (outbound — resolves ALL vars)', () => {
  it('resolves url, enabled + disabled header values, and body content', () => {
    const e = env([
      { key: 'host', value: 'api.example.com', secret: false },
      { key: 'token', value: 'sk-live-123', secret: true },
      { key: 'name', value: 'Ada', secret: false },
    ]);
    const r = req({
      url: 'https://{{host}}/users',
      headers: [
        { name: 'Authorization', value: 'Bearer {{token}}', enabled: true },
        { name: 'X-Off', value: '{{host}}', enabled: false },
      ],
      method: 'POST',
      body: { kind: 'json', content: '{"name":"{{name}}"}' },
    });
    const out = interpolateRequest(r, e);
    expect(out.url).toBe('https://api.example.com/users');
    // Secret resolves on the OUTBOUND request (it must reach the wire).
    expect(out.headers[0]?.value).toBe('Bearer sk-live-123');
    // Disabled rows are still interpolated structurally (they just are
    // not sent — composeRequestHeaders drops them).
    expect(out.headers[1]?.value).toBe('api.example.com');
    expect(out.body?.content).toBe('{"name":"Ada"}');
    // version / id pins preserved.
    expect(out.version).toBe(1);
    expect(out.id).toBe('r1');
  });

  it('returns the request unchanged when env is null', () => {
    const r = req({ url: 'https://{{host}}/x' });
    const out = interpolateRequest(r, null);
    expect(out.url).toBe('https://{{host}}/x');
    expect(out).not.toBe(r); // structurally cloned
  });
});

// ---------------------------------------------------------------------------
// RL-097 Slice 3b — auth is a first-class env surface.
// ---------------------------------------------------------------------------

describe('auth interpolation (RL-097 Slice 3b)', () => {
  function authReq(auth: HttpRequestAuth): HttpRequestV1 {
    return req({ url: 'https://api.example.com', auth });
  }

  it('interpolateRequest resolves the bearer token (outbound)', () => {
    const e = env([{ key: 'token', value: 'sk-live-123', secret: false }]);
    const out = interpolateRequest(
      authReq({ kind: 'bearer', token: 'Bearer-prefix {{token}}' }),
      e
    );
    expect(out.auth?.token).toBe('Bearer-prefix sk-live-123');
    expect(out.auth?.kind).toBe('bearer');
  });

  it('interpolateRequest resolves basic username + password', () => {
    const e = env([
      { key: 'user', value: 'ada', secret: false },
      { key: 'pass', value: 'hunter2', secret: false },
    ]);
    const out = interpolateRequest(
      authReq({ kind: 'basic', username: '{{user}}', password: '{{pass}}' }),
      e
    );
    expect(out.auth?.username).toBe('ada');
    expect(out.auth?.password).toBe('hunter2');
  });

  it('interpolateRequest resolves apiKey header name + value', () => {
    const e = env([
      { key: 'hdr', value: 'X-Custom-Key', secret: false },
      { key: 'val', value: 'abc123', secret: false },
    ]);
    const out = interpolateRequest(
      authReq({ kind: 'apiKey', apiKeyHeader: '{{hdr}}', apiKeyValue: '{{val}}' }),
      e
    );
    expect(out.auth?.apiKeyHeader).toBe('X-Custom-Key');
    expect(out.auth?.apiKeyValue).toBe('abc123');
  });

  it('leaves auth untouched for kind none', () => {
    const e = env([{ key: 'token', value: 'x', secret: false }]);
    const out = interpolateRequest(authReq({ kind: 'none' }), e);
    expect(out.auth).toEqual({ kind: 'none' });
  });

  it('PRIVACY: a SECRET token in the Bearer field resolves OUTBOUND but maskSecretsForCapsule keeps it {{key}}', () => {
    const SECRET = 'sk-live-AUTHSECRET';
    const e = env([{ key: 'token', value: SECRET, secret: true }]);
    const r = authReq({ kind: 'bearer', token: '{{token}}' });

    // Outbound: the resolved secret MUST reach the wire to authenticate.
    const outbound = interpolateRequest(r, e);
    expect(outbound.auth?.token).toBe(SECRET);

    // Capsule-safe: the secret stays a placeholder — never the resolved value.
    const masked = maskSecretsForCapsule(r, e);
    expect(masked.auth?.token).toBe('{{token}}');
    expect(JSON.stringify(masked)).not.toContain(SECRET);
  });

  it('PRIVACY: a SECRET basic password is masked in the capsule but resolved outbound', () => {
    const SECRET = 'p@ss-SECRET';
    const e = env([{ key: 'pw', value: SECRET, secret: true }]);
    const r = authReq({ kind: 'basic', username: 'ada', password: '{{pw}}' });
    expect(interpolateRequest(r, e).auth?.password).toBe(SECRET);
    const masked = maskSecretsForCapsule(r, e);
    expect(masked.auth?.password).toBe('{{pw}}');
    expect(JSON.stringify(masked)).not.toContain(SECRET);
  });

  it('findUnresolvedVariables scans auth fields when present', () => {
    const e = env([{ key: 'known', value: 'x', secret: false }]);
    const r = authReq({
      kind: 'apiKey',
      apiKeyHeader: '{{known}}',
      apiKeyValue: '{{missingAuthVar}}',
    });
    expect(findUnresolvedVariables(r, e)).toEqual(['missingAuthVar']);
  });

  it('findResolvedVariables scans auth fields when present', () => {
    const e = env([
      { key: 'token', value: 'x', secret: true },
      { key: 'unused', value: 'y', secret: false },
    ]);
    const r = authReq({ kind: 'bearer', token: '{{token}}' });
    expect(findResolvedVariables(r, e)).toEqual(['token']);
  });

  it('does NOT scan auth fields for kind none', () => {
    const r = authReq({ kind: 'none', token: '{{ghost}}' });
    expect(findUnresolvedVariables(r, null)).toEqual([]);
  });
});

describe('findUnresolvedVariables', () => {
  it('collects distinct missing tokens in first-seen order, deduped', () => {
    const e = env([{ key: 'host', value: 'x', secret: false }]);
    const r = req({
      url: 'https://{{host}}/{{a}}/{{b}}',
      headers: [{ name: 'X', value: '{{a}} {{c}}', enabled: true }],
    });
    expect(findUnresolvedVariables(r, e)).toEqual(['a', 'b', 'c']);
  });

  it('treats an empty-valued binding as resolved (bound, just blank)', () => {
    const e = env([{ key: 'host', value: '', secret: false }]);
    expect(findUnresolvedVariables(req({ url: '{{host}}' }), e)).toEqual([]);
  });

  it('ignores disabled header rows', () => {
    const e = env([]);
    const r = req({
      url: 'https://example.com',
      headers: [{ name: 'X', value: '{{secretish}}', enabled: false }],
    });
    expect(findUnresolvedVariables(r, e)).toEqual([]);
  });

  it('with env null, ALL referenced tokens are unresolved', () => {
    const r = req({
      url: 'https://{{host}}/{{path}}',
      method: 'POST',
      body: { kind: 'text', content: '{{bodyvar}}' },
    });
    expect(findUnresolvedVariables(r, null)).toEqual([
      'host',
      'path',
      'bodyvar',
    ]);
  });
});

describe('findResolvedVariables', () => {
  it('collects distinct resolved tokens, deduped, in first-seen order', () => {
    const e = env([
      { key: 'host', value: 'x', secret: false },
      { key: 'token', value: 'y', secret: true },
    ]);
    const r = req({
      url: 'https://{{host}}/{{host}}',
      headers: [{ name: 'A', value: '{{token}} {{missing}}', enabled: true }],
    });
    expect(findResolvedVariables(r, e)).toEqual(['host', 'token']);
  });

  it('returns [] when env is null', () => {
    expect(findResolvedVariables(req(), null)).toEqual([]);
  });
});

describe('maskSecretsForCapsule (non-secret resolved, secret left as {{key}})', () => {
  it('resolves non-secret vars but keeps secret tokens verbatim', () => {
    const e = env([
      { key: 'host', value: 'api.example.com', secret: false },
      { key: 'token', value: 'sk-live-XYZ', secret: true },
    ]);
    const r = req({
      url: 'https://{{host}}/users',
      headers: [
        { name: 'Authorization', value: 'Bearer {{token}}', enabled: true },
      ],
      method: 'POST',
      body: { kind: 'json', content: '{"h":"{{host}}","t":"{{token}}"}' },
    });
    const masked = maskSecretsForCapsule(r, e);
    expect(masked.url).toBe('https://api.example.com/users');
    // The resolved secret value must NEVER appear.
    expect(masked.headers[0]?.value).toBe('Bearer {{token}}');
    expect(masked.headers[0]?.value).not.toContain('sk-live-XYZ');
    expect(masked.body?.content).toBe('{"h":"api.example.com","t":"{{token}}"}');
    expect(masked.body?.content).not.toContain('sk-live-XYZ');
  });

  it('leaves unknown tokens verbatim', () => {
    const e = env([{ key: 'host', value: 'x', secret: false }]);
    const masked = maskSecretsForCapsule(req({ url: '{{host}}/{{unknown}}' }), e);
    expect(masked.url).toBe('x/{{unknown}}');
  });

  it('uses the final duplicate binding when masking secrets', () => {
    const e = env([
      { key: 'token', value: 'old-public-value', secret: false },
      { key: 'token', value: 'sk-final-secret', secret: true },
    ]);
    const masked = maskSecretsForCapsule(
      req({ url: 'https://x.dev/{{token}}' }),
      e
    );
    expect(masked.url).toBe('https://x.dev/{{token}}');
    expect(masked.url).not.toContain('old-public-value');
    expect(masked.url).not.toContain('sk-final-secret');
  });

  it('returns the request unchanged when env is null', () => {
    const masked = maskSecretsForCapsule(req({ url: '{{host}}' }), null);
    expect(masked.url).toBe('{{host}}');
  });
});

describe('collectSecretResolvedValues', () => {
  it('returns resolved values of non-empty secret vars only', () => {
    const e = env([
      { key: 'a', value: 'secretA', secret: true },
      { key: 'b', value: 'notSecret', secret: false },
      { key: 'c', value: '', secret: true }, // empty secret skipped
    ]);
    expect(collectSecretResolvedValues(e)).toEqual(['secretA']);
  });

  it('collects only final secret duplicate bindings for response scrubbing', () => {
    const e = env([
      { key: 'token', value: 'shadowed-secret', secret: true },
      { key: 'token', value: 'public-final', secret: false },
      { key: 'apiKey', value: 'sent-secret', secret: true },
    ]);
    expect(collectSecretResolvedValues(e)).toEqual(['sent-secret']);
  });

  it('returns [] for a null env', () => {
    expect(collectSecretResolvedValues(null)).toEqual([]);
  });
});

describe('maskSecretValuesInResponse', () => {
  it('scrubs secret values from every URL-bearing + text field', () => {
    const r = resp({
      body: 'echo: sk-live-XYZ here',
      // `url` is the ORIGINAL (resolved outbound) URL — a secret in a
      // query param lands here verbatim. This is the field the live
      // smoke caught leaking; the regression must pin it.
      url: 'https://x.dev/anything?token=sk-live-XYZ',
      finalUrl: 'https://x.dev/cb?token=sk-live-XYZ',
      statusText: 'sk-live-XYZ',
      errorMessage: 'Failed to fetch https://x.dev/anything?token=sk-live-XYZ',
      headers: [
        { name: 'X-Echo', value: 'sk-live-XYZ', redacted: false },
        { name: 'X-Other', value: 'plain', redacted: false },
      ],
    });
    const scrubbed = maskSecretValuesInResponse(r, ['sk-live-XYZ']);
    expect(scrubbed.body).toBe('echo: <redacted> here');
    expect(scrubbed.url).toBe('https://x.dev/anything?token=<redacted>');
    expect(scrubbed.finalUrl).toBe('https://x.dev/cb?token=<redacted>');
    expect(scrubbed.statusText).toBe('<redacted>');
    expect(scrubbed.errorMessage).toBe(
      'Failed to fetch https://x.dev/anything?token=<redacted>'
    );
    expect(scrubbed.headers[0]?.value).toBe('<redacted>');
    expect(scrubbed.headers[1]?.value).toBe('plain');
    // No occurrence of the secret survives ANYWHERE in the response.
    expect(JSON.stringify(scrubbed)).not.toContain('sk-live-XYZ');
  });

  it('scrubs every occurrence (global), and handles regex-metachar secrets literally', () => {
    const r = resp({ body: 'a.b a.b a.b' });
    const scrubbed = maskSecretValuesInResponse(r, ['a.b']);
    // Literal replace: only the literal "a.b" is matched, not the regex
    // "any char between a and b". Here every token is literally "a.b".
    expect(scrubbed.body).toBe('<redacted> <redacted> <redacted>');
  });

  it('is a no-op (same reference) when secretValues is empty', () => {
    const r = resp({ body: 'unchanged' });
    expect(maskSecretValuesInResponse(r, [])).toBe(r);
  });
});

describe('parseHttpEnvironment', () => {
  it('parses a valid environment', () => {
    const parsed = parseHttpEnvironment({
      version: 1,
      id: 'e1',
      name: 'Prod',
      variables: [{ key: 'host', value: 'x', secret: true }],
      createdAt: '2026-06-16T00:00:00.000Z',
      updatedAt: '2026-06-16T00:00:00.000Z',
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.variables[0]).toMatchObject({
      key: 'host',
      value: 'x',
      secret: true,
    });
    // Slice 3b — a row with no `id` is backfilled with a fresh UUID.
    expect(typeof parsed?.variables[0]?.id).toBe('string');
    expect(parsed?.variables[0]?.id.length).toBeGreaterThan(0);
  });

  it('keeps a non-empty persisted variable id, backfills a missing one', () => {
    const parsed = parseHttpEnvironment({
      version: 1,
      id: 'e1',
      name: 'Prod',
      variables: [
        { id: 'keep-me', key: 'a', value: '1', secret: false },
        { key: 'b', value: '2', secret: false },
      ],
      createdAt: '2026-06-16T00:00:00.000Z',
      updatedAt: '2026-06-16T00:00:00.000Z',
    });
    expect(parsed?.variables[0]?.id).toBe('keep-me');
    expect(parsed?.variables[1]?.id).toBeTruthy();
    expect(parsed?.variables[1]?.id).not.toBe('keep-me');
  });

  it('rejects a wrong version', () => {
    expect(
      parseHttpEnvironment({
        version: 2,
        id: 'e1',
        name: 'Prod',
        variables: [],
        createdAt: 'a',
        updatedAt: 'b',
      })
    ).toBeNull();
  });

  it('drops invalid variable rows but keeps the environment', () => {
    const parsed = parseHttpEnvironment({
      version: 1,
      id: 'e1',
      name: 'Prod',
      variables: [
        { key: 'ok', value: 'v', secret: false },
        { key: 123, value: 'bad-key' }, // dropped
        { value: 'no-key' }, // dropped
        { key: 'noSecretFlag', value: 'v' }, // kept, secret defaults false
      ],
      createdAt: 'a',
      updatedAt: 'b',
    });
    // Ignore the backfilled opaque ids — assert on the semantic fields.
    expect(
      parsed?.variables.map((v) => ({
        key: v.key,
        value: v.value,
        secret: v.secret,
      }))
    ).toEqual([
      { key: 'ok', value: 'v', secret: false },
      { key: 'noSecretFlag', value: 'v', secret: false },
    ]);
  });

  it('returns null on a hard top-level shape failure', () => {
    expect(parseHttpEnvironment(null)).toBeNull();
    expect(parseHttpEnvironment('nope')).toBeNull();
    expect(
      parseHttpEnvironment({ version: 1, id: 'e1', name: 'x', variables: 'no' })
    ).toBeNull();
  });
});

describe('createBlankHttpEnvironment', () => {
  it('builds a v1 environment with empty variables', () => {
    const e = createBlankHttpEnvironment({
      id: 'e1',
      name: 'Dev',
      now: '2026-06-16T00:00:00.000Z',
    });
    expect(e).toEqual({
      version: 1,
      id: 'e1',
      name: 'Dev',
      variables: [],
      createdAt: '2026-06-16T00:00:00.000Z',
      updatedAt: '2026-06-16T00:00:00.000Z',
    });
  });
});

describe('createEnvVariable (RL-097 Slice 3b)', () => {
  it('mints a fresh id and carries the fields through', () => {
    const a = createEnvVariable({ key: 'k', value: 'v', secret: true });
    const b = createEnvVariable({ key: 'k', value: 'v', secret: true });
    expect(a).toMatchObject({ key: 'k', value: 'v', secret: true });
    expect(typeof a.id).toBe('string');
    expect(a.id.length).toBeGreaterThan(0);
    expect(a.id).not.toBe(b.id); // unique per call
  });
});

describe('looksSecret (RL-097 Slice 3b)', () => {
  it('matches token-like keys (suffix + whole-word, case-insensitive)', () => {
    for (const key of [
      'API_TOKEN',
      'api_token',
      'TOKEN',
      'token',
      'STRIPE_SECRET_KEY',
      'apiKey',
      'API_KEY',
      'KEY',
      'SECRET',
      'client_secret',
      'PASSWORD',
      'password',
      'DB_PASSWORD',
    ]) {
      expect(looksSecret(key)).toBe(true);
    }
  });

  it('does NOT match non-secret keys (no false positives)', () => {
    for (const key of [
      'host',
      'HOST',
      'name',
      'baseUrl',
      'base_url',
      'path',
      'id',
      'MONKEY', // KEY inside a word
      'BROKER', // KER inside a word
      'version',
      '',
    ]) {
      expect(looksSecret(key)).toBe(false);
    }
  });
});

describe('toExportableEnvironment (RL-097 Slice 3b — privacy)', () => {
  it('blanks secret values, keeps non-secret values, strips all ids', () => {
    const e = env(
      [
        { key: 'host', value: 'api.example.com', secret: false },
        { key: 'token', value: 'sk-live-EXPORTSECRET', secret: true },
      ],
      { id: 'env-local', name: 'Dev' }
    );
    const exported = toExportableEnvironment(e);
    expect(exported).toEqual({
      version: 1,
      name: 'Dev',
      variables: [
        { key: 'host', value: 'api.example.com', secret: false },
        // Secret value blanked; key + flag preserved.
        { key: 'token', value: '', secret: true },
      ],
    });
    // No env id, no variable ids, and absolutely no resolved secret value.
    const json = JSON.stringify(exported);
    expect(json).not.toContain('env-local');
    expect(json).not.toContain('sk-live-EXPORTSECRET');
    expect('id' in exported).toBe(false);
    for (const v of exported.variables) {
      expect('id' in v).toBe(false);
    }
  });

  it('round-trips through parseHttpEnvironment (re-pinned id + timestamps), secret value stays blank', () => {
    const e = env([{ key: 'token', value: 'sk-SECRET', secret: true }], {
      name: 'Prod',
    });
    const exported = toExportableEnvironment(e);
    // Mirror the store importer: layer a fresh id + timestamps onto the
    // exported shape, then parse (which backfills variable ids).
    const reparsed = parseHttpEnvironment({
      ...exported,
      id: 'fresh-id',
      createdAt: '2026-06-16T00:00:00.000Z',
      updatedAt: '2026-06-16T00:00:00.000Z',
    });
    expect(reparsed?.name).toBe('Prod');
    expect(reparsed?.variables[0]).toMatchObject({
      key: 'token',
      value: '', // still blank — a shared secret is never carried
      secret: true,
    });
    expect(reparsed?.variables[0]?.id).toBeTruthy();
  });
});
