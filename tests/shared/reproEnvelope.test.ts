import { describe, expect, it } from 'vitest';
import {
  approveReproEnvelope,
  buildReproEnvelope,
  checkReproApproval,
  computeReproContentDigest,
  parseReproEnvelope,
  type BuildReproEnvelopeInput,
  type ReproEnvelopeV1,
} from '../../src/shared/reproEnvelope';
import { DEFAULT_REPRO_REQUEST, type ReproPolicyV1 } from '../../src/shared/reproPolicy';
import { computeContentHash } from '../../src/shared/runCapsule';
import { FIXTURE_FULL_TS, FIXTURE_MINIMAL_JS } from './runCapsule.fixtures';
import { tamperJson, type Tamperable } from './jsonTamper';
import { FAKE_GITHUB_PAT_SOURCE } from './secret.fixtures';

const UTIL_FILE = {
  path: 'lib/sum.mjs',
  language: 'javascript',
  content: 'export const sum = (a, b) => a + b;\n',
};

function input(overrides: Partial<BuildReproEnvelopeInput> = {}): BuildReproEnvelopeInput {
  return {
    capsule: FIXTURE_MINIMAL_JS,
    entry: 'main.mjs',
    runtime: { name: 'node', major: 24 },
    files: [UTIL_FILE],
    request: DEFAULT_REPRO_REQUEST,
    createdAtMs: Date.UTC(2026, 9, 29),
    ...overrides,
  };
}

async function builtEnvelope(overrides: Partial<BuildReproEnvelopeInput> = {}) {
  const built = await buildReproEnvelope(input(overrides));
  if (!built.ok) throw new Error(`fixture envelope rejected: ${built.reason}`);
  return built;
}

/** Changes a file's bytes and stores the matching hash, as an honest edit would. */
async function withEditedFile(
  envelope: ReproEnvelopeV1,
  content: string
): Promise<ReproEnvelopeV1> {
  return {
    ...envelope,
    files: [{ ...envelope.files[0]!, content, contentHash: await computeContentHash(content) }],
  };
}

describe('buildReproEnvelope', () => {
  it('builds an envelope that parses back to the same value', async () => {
    const built = await builtEnvelope();

    expect(built.value.entry).toBe('main.mjs');
    expect(built.value.files[0]?.contentHash).toBe(await computeContentHash(UTIL_FILE.content));
    expect(built.value.privacy).toEqual({
      sourceReview: 'explicit',
      absolutePathsIncluded: false,
      obviousSecretsDetected: 0,
    });
    expect(built.json).not.toContain('/Users/');
    expect(parseReproEnvelope(built.json)).toEqual({ ok: true, value: built.value });
  });

  it('accepts a single-source reproduction with no supplemental files', async () => {
    const built = await builtEnvelope({ files: [] });

    expect(built.value.files).toEqual([]);
    expect(parseReproEnvelope(built.json)).toEqual({ ok: true, value: built.value });
  });

  it('counts obvious secrets without changing the source', async () => {
    const secretFile = {
      path: 'config.mjs',
      language: 'javascript',
      content: FAKE_GITHUB_PAT_SOURCE,
    };
    const built = await builtEnvelope({ files: [secretFile] });

    expect(built.value.privacy.obviousSecretsDetected).toBeGreaterThan(0);
    expect(built.value.files[0]?.content).toBe(FAKE_GITHUB_PAT_SOURCE);
  });

  it.each<[string, Partial<BuildReproEnvelopeInput>, string, string | undefined]>([
    ['a TypeScript capsule', { capsule: FIXTURE_FULL_TS }, 'unsupported-language', 'typescript'],
    [
      'an entry that leaves the staging root',
      { entry: '../main.mjs' },
      'invalid-entry',
      '../main.mjs',
    ],
    ['an absolute entry', { entry: '/tmp/main.mjs' }, 'invalid-entry', '/tmp/main.mjs'],
    [
      'a .js entry whose module format is ambiguous',
      { entry: 'main.js' },
      'invalid-entry',
      'main.js',
    ],
    ['an entry with surrounding spaces', { entry: ' main.mjs' }, 'invalid-entry', ' main.mjs'],
    [
      'an entry that collides with a supplemental file regardless of case',
      { entry: 'LIB/Sum.mjs' },
      'invalid-entry',
      'LIB/Sum.mjs',
    ],
    [
      'a runtime other than node',
      { runtime: { name: 'deno', major: 2 } as never },
      'unsupported-runtime',
      undefined,
    ],
    [
      'a node major below 18',
      { runtime: { name: 'node', major: 17 } },
      'unsupported-runtime',
      undefined,
    ],
    [
      'a request with network access',
      { request: { ...DEFAULT_REPRO_REQUEST, network: 'allow' } as never },
      'invalid-policy',
      'unsupported-value:network',
    ],
    [
      'a supplemental file outside the staging root',
      { files: [{ ...UTIL_FILE, path: '../secret.mjs' }] },
      'invalid-path',
      '../secret.mjs',
    ],
  ])('rejects %s', async (_name, overrides, reason, detail) => {
    expect(await buildReproEnvelope(input(overrides))).toEqual({
      ok: false,
      reason,
      ...(detail === undefined ? {} : { detail }),
    });
  });
});

describe('parseReproEnvelope', () => {
  it.each<[string, (raw: Tamperable<ReproEnvelopeV1>) => void, string, string | undefined]>([
    [
      'an unknown top-level key',
      raw => Object.assign(raw, { grants: ['/'] }),
      'unknown-key',
      'grants',
    ],
    [
      'a newer version',
      raw => Object.assign(raw, { version: 2 }),
      'unsupported-version',
      'version=2',
    ],
    [
      'another artifact kind',
      raw => Object.assign(raw, { kind: 'lingua-capsule-workspace' }),
      'invalid-shape',
      'kind',
    ],
    [
      'a privacy block that admits absolute paths',
      raw => Object.assign(raw.privacy, { absolutePathsIncluded: true }),
      'invalid-shape',
      'privacy',
    ],
    [
      'an extra key on a file',
      raw => Object.assign(raw.files[0]!, { mode: '0755' }),
      'invalid-shape',
      'file fields',
    ],
    [
      'an absolute supplemental path',
      raw => (raw.files[0]!.path = '/etc/hosts'),
      'invalid-path',
      '/etc/hosts',
    ],
    [
      'a supplemental path that only becomes portable after trimming',
      raw => (raw.files[0]!.path = ' lib/sum.mjs'),
      'invalid-path',
      undefined,
    ],
    [
      'a request that names its own grants',
      raw => Object.assign(raw.request.filesystem, { home: 'read-only' }),
      'invalid-policy',
      'unknown-key:filesystem.home',
    ],
    [
      'a runtime with an unknown key',
      raw => Object.assign(raw.runtime, { flags: ['--allow-all'] }),
      'unsupported-runtime',
      undefined,
    ],
  ])('rejects %s', async (_name, mutate, reason, detail) => {
    const built = await builtEnvelope();

    expect(parseReproEnvelope(tamperJson(built.value, mutate))).toEqual({
      ok: false,
      reason,
      ...(detail === undefined ? {} : { detail }),
    });
  });

  it('recomputes the secret count instead of trusting the stored one', async () => {
    const secretFile = {
      path: 'config.mjs',
      language: 'javascript',
      content: FAKE_GITHUB_PAT_SOURCE,
    };
    const built = await builtEnvelope({ files: [secretFile] });
    const understated = tamperJson(built.value, raw => (raw.privacy.obviousSecretsDetected = 0));

    const parsed = parseReproEnvelope(understated);

    expect(parsed.ok && parsed.value.privacy.obviousSecretsDetected).toBeGreaterThan(0);
  });
});

describe('computeReproContentDigest', () => {
  it('does not depend on supplemental file order', async () => {
    const other = { path: 'lib/zero.mjs', language: 'javascript', content: 'export default 0;\n' };
    const forward = await builtEnvelope({ files: [UTIL_FILE, other] });
    const reversed = await builtEnvelope({ files: [other, UTIL_FILE] });

    expect(await computeReproContentDigest(forward.value)).toEqual(
      await computeReproContentDigest(reversed.value)
    );
  });

  it('changes when a supplemental file changes', async () => {
    const { value } = await builtEnvelope();
    const edited = await withEditedFile(value, 'export const sum = (a, b) => a - b;\n');

    const before = await computeReproContentDigest(value);
    const after = await computeReproContentDigest(edited);

    expect(before.ok && after.ok && before.digest !== after.digest).toBe(true);
  });

  it('changes when the entry is staged at another path', async () => {
    const asMjs = await builtEnvelope({ entry: 'main.mjs' });
    const asCjs = await builtEnvelope({ entry: 'main.cjs' });

    const mjs = await computeReproContentDigest(asMjs.value);
    const cjs = await computeReproContentDigest(asCjs.value);

    expect(mjs.ok && cjs.ok && mjs.digest !== cjs.digest).toBe(true);
  });

  it.each<[string, (envelope: ReproEnvelopeV1) => ReproEnvelopeV1]>([
    [
      'stdin',
      envelope => ({ ...envelope, capsule: { ...envelope.capsule, input: { stdin: 'other' } } }),
    ],
    [
      'the arguments',
      envelope => ({ ...envelope, capsule: { ...envelope.capsule, input: { args: ['--fast'] } } }),
    ],
    [
      'the expected stdout',
      envelope => ({
        ...envelope,
        capsule: { ...envelope.capsule, result: { ...envelope.capsule.result, stdout: '4\n' } },
      }),
    ],
    ['the runtime major', envelope => ({ ...envelope, runtime: { name: 'node', major: 22 } })],
  ])('changes when %s changes', async (_name, edit) => {
    const { value } = await builtEnvelope();

    const before = await computeReproContentDigest(value);
    const after = await computeReproContentDigest(edit(value));

    expect(before.ok && after.ok && before.digest !== after.digest).toBe(true);
  });

  it('refuses a file whose bytes no longer match its stored hash', async () => {
    const { value } = await builtEnvelope();
    const tampered = { ...value, files: [{ ...value.files[0]!, content: 'process.exit(0);\n' }] };

    expect(await computeReproContentDigest(tampered)).toEqual({
      ok: false,
      reason: 'hash-mismatch',
      path: 'lib/sum.mjs',
    });
  });

  it('refuses an entry source whose bytes no longer match the capsule hash', async () => {
    const { value } = await builtEnvelope();
    const tampered = {
      ...value,
      capsule: { ...value.capsule, source: { ...value.capsule.source, content: 'console.log(4)' } },
    };

    expect(await computeReproContentDigest(tampered)).toEqual({
      ok: false,
      reason: 'hash-mismatch',
      path: 'main.mjs',
    });
  });
});

describe('approval binding', () => {
  const OUTPUT_CLOSED_CEILING: ReproPolicyV1 = {
    ...DEFAULT_REPRO_REQUEST,
    filesystem: { ...DEFAULT_REPRO_REQUEST.filesystem, output: 'none' },
  };

  async function approved() {
    const { value } = await builtEnvelope();
    const result = await approveReproEnvelope(value, OUTPUT_CLOSED_CEILING);
    if (!result.ok) throw new Error('fixture approval failed');
    return { envelope: value, policy: result.policy, approval: result.approval };
  }

  it('approves the narrowed policy and validates it unchanged', async () => {
    const { envelope, policy, approval } = await approved();

    expect(policy.filesystem.output).toBe('none');
    expect(await checkReproApproval(envelope, policy, approval)).toBe('valid');
  });

  it('invalidates the approval when an input changes after review', async () => {
    const { envelope, policy, approval } = await approved();
    const edited = await withEditedFile(envelope, 'export const sum = () => 0;\n');

    expect(await checkReproApproval(edited, policy, approval)).toBe('content-changed');
  });

  it('invalidates the approval when the policy is swapped for the full request', async () => {
    const { envelope, approval } = await approved();

    expect(await checkReproApproval(envelope, envelope.request, approval)).toBe('policy-changed');
  });

  it('rejects a policy wider than the request before comparing digests', async () => {
    const { value } = await builtEnvelope({
      request: {
        ...DEFAULT_REPRO_REQUEST,
        filesystem: { ...DEFAULT_REPRO_REQUEST.filesystem, scratch: 'none' },
      },
    });
    const result = await approveReproEnvelope(value, DEFAULT_REPRO_REQUEST);
    if (!result.ok) throw new Error('fixture approval failed');

    expect(await checkReproApproval(value, DEFAULT_REPRO_REQUEST, result.approval)).toBe(
      'policy-wider-than-request'
    );
  });

  it('reports a hash mismatch instead of a content change for tampered bytes', async () => {
    const { envelope, policy, approval } = await approved();
    const tampered = {
      ...envelope,
      files: [{ ...envelope.files[0]!, content: 'process.exit(0);\n' }],
    };

    expect(await checkReproApproval(tampered, policy, approval)).toBe('hash-mismatch');
  });
});
