import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  runReproPackCommand,
  runReproReviewCommand,
  runReproRunCommand,
  type ReproRunArgs,
} from '../../../src/cli/commands/repro';
import { CLI_EXIT_CODES } from '../../../src/cli/exit-codes';
import type {
  ReproContainmentBackend,
  ReproLaunchRequest,
  ReproNodeRuntime,
} from '../../../src/cli/runtime/containment';
import type { CliExecutionResult } from '../../../src/cli/runtime/execution';
import {
  buildReproEnvelope,
  computeReproApprovalToken,
  parseReproEnvelope,
} from '../../../src/shared/reproEnvelope';
import {
  DEFAULT_REPRO_REQUEST,
  REPRO_CONTROLS,
  requiredReproControls,
  type ReproControl,
  type ReproControlSupport,
} from '../../../src/shared/reproPolicy';
import { parseReproReceipt } from '../../../src/shared/reproReceipt';
import { FIXTURE_FULL_TS, FIXTURE_MINIMAL_JS } from '../../shared/runCapsule.fixtures';
import { FAKE_GITHUB_PAT_SOURCE } from '../../shared/secret.fixtures';
import { createFakeIo } from '../io-fake';

const HELPER = 'export const sum = (a, b) => a + b;\n';
const OUTPUT = { json: false, quiet: false } as const;
const JSON_OUTPUT = { json: true, quiet: false } as const;
const MANDATORY_CONTROLS = requiredReproControls(DEFAULT_REPRO_REQUEST);

const NODE_24: ReproNodeRuntime = { path: '/opt/node/bin/node', version: '24.21.0' };

function executionResult(overrides: Partial<CliExecutionResult> = {}): CliExecutionResult {
  return {
    status: 'success',
    target: 'main.mjs',
    runtime: 'node 24.21.0',
    durationMs: 12,
    exitCode: 0,
    signal: null,
    stdout: FIXTURE_MINIMAL_JS.result.stdout ?? '',
    stderr: '',
    ...overrides,
  };
}

/** A backend that enforces everything unless told otherwise and records each launch. */
function backend(
  overrides: Partial<Record<ReproControl, ReproControlSupport>> = {},
  launch: (request: ReproLaunchRequest) => Promise<CliExecutionResult> = async () =>
    executionResult()
): ReproContainmentBackend & { launches: ReproLaunchRequest[] } {
  const controls = Object.fromEntries(
    REPRO_CONTROLS.map(control => [control, 'enforced'])
  ) as Record<ReproControl, ReproControlSupport>;
  const launches: ReproLaunchRequest[] = [];
  return {
    id: 'fake-backend',
    launches,
    async probe() {
      return {
        backend: { id: 'fake-backend', version: '1' },
        controls: { ...controls, ...overrides },
        ambientGrants: [],
      };
    },
    async launch(request) {
      launches.push(request);
      return {
        result: await launch(request),
        startedAt: new Date('2026-10-29T12:00:00.000Z'),
        endedAt: new Date('2026-10-29T12:00:00.250Z'),
        evidence: { coverage: 'unavailable', denials: [] },
      };
    },
  };
}

async function envelopeJson(): Promise<string> {
  const built = await buildReproEnvelope({
    capsule: FIXTURE_MINIMAL_JS,
    entry: 'main.mjs',
    runtime: { name: 'node', major: 24 },
    files: [{ path: 'lib/sum.mjs', language: 'javascript', content: HELPER }],
    request: DEFAULT_REPRO_REQUEST,
  });
  if (!built.ok) throw new Error(`fixture envelope rejected: ${built.reason}`);
  return built.json;
}

async function reviewToken(json: string): Promise<string> {
  const { io, state } = createFakeIo({ files: { '/work/repro.json': json } });
  await runReproReviewCommand(
    {
      ...JSON_OUTPUT,
      envelopePath: '/work/repro.json',
      backends: [],
      resolveNode: async () => NODE_24,
    },
    io
  );
  return (JSON.parse(state.stdout) as { approval: { token: string } }).approval.token;
}

function runArgs(overrides: Partial<ReproRunArgs> & Pick<ReproRunArgs, 'approve'>): ReproRunArgs {
  return {
    ...JSON_OUTPUT,
    envelopePath: '/work/repro.json',
    linguaVersion: '1.6.2',
    now: () => new Date('2026-10-29T12:00:00.000Z'),
    backends: [],
    resolveNode: async () => NODE_24,
    ...overrides,
  };
}

describe('lingua repro pack', () => {
  const capsuleFiles = {
    '/work/run.capsule.json': JSON.stringify(FIXTURE_MINIMAL_JS),
    '/work/lib/sum.mjs': HELPER,
  };

  it('prints an envelope with the capsule as entry and the chosen file', async () => {
    const { io, state } = createFakeIo({ files: capsuleFiles });

    const code = await runReproPackCommand(
      {
        ...OUTPUT,
        capsulePath: '/work/run.capsule.json',
        entry: 'main.mjs',
        files: ['lib/sum.mjs'],
        root: '/work',
        nodeMajor: 24,
      },
      io
    );

    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stderr).toBe('');
    const parsed = parseReproEnvelope(state.stdout);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.entry).toBe('main.mjs');
    expect(parsed.value.runtime).toEqual({ name: 'node', major: 24 });
    expect(parsed.value.files.map(file => [file.path, file.language, file.content])).toEqual([
      ['lib/sum.mjs', 'javascript', HELPER],
    ]);
    expect(parsed.value.request).toEqual(DEFAULT_REPRO_REQUEST);
  });

  it('warns about possible secrets on stderr and still prints the envelope', async () => {
    const { io, state } = createFakeIo({
      files: { ...capsuleFiles, '/work/config.mjs': FAKE_GITHUB_PAT_SOURCE },
    });

    const code = await runReproPackCommand(
      {
        ...OUTPUT,
        capsulePath: '/work/run.capsule.json',
        entry: 'main.mjs',
        files: ['config.mjs'],
        root: '/work',
      },
      io
    );

    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stderr).toContain('possible secret(s) in the packed files');
    expect(parseReproEnvelope(state.stdout).ok).toBe(true);
  });

  it.each<
    [string, { realPaths?: Record<string, string>; bytes?: Record<string, Uint8Array> }, string]
  >([
    [
      'a file that resolves outside the root through a symlink',
      { realPaths: { '/work/lib/sum.mjs': '/home/me/.aws/credentials' } },
      'outside-root',
    ],
    [
      'a file that is not UTF-8 text',
      { bytes: { '/work/lib/sum.mjs': new Uint8Array([0x63, 0x61, 0x66, 0xe9]) } },
      'not-utf8',
    ],
  ])('refuses %s', async (_name, io, reason) => {
    const { io: fake, state } = createFakeIo({ files: capsuleFiles, ...io });

    const code = await runReproPackCommand(
      {
        ...JSON_OUTPUT,
        capsulePath: '/work/run.capsule.json',
        entry: 'main.mjs',
        files: ['lib/sum.mjs'],
        root: '/work',
      },
      fake
    );

    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(JSON.parse(state.stdout)).toMatchObject({ ok: false, reason });
  });

  it('packs a file whose symlink stays inside a symlinked root', async () => {
    const { io, state } = createFakeIo({
      files: capsuleFiles,
      realPaths: { '/work': '/private/work', '/work/lib/sum.mjs': '/private/work/src/sum.mjs' },
    });

    const code = await runReproPackCommand(
      {
        ...OUTPUT,
        capsulePath: '/work/run.capsule.json',
        entry: 'main.mjs',
        files: ['lib/sum.mjs'],
        root: '/work',
      },
      io
    );

    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(parseReproEnvelope(state.stdout).ok).toBe(true);
  });

  it('keeps a byte-order mark as part of the packed content', async () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(HELPER)]);
    const { io, state } = createFakeIo({
      files: capsuleFiles,
      bytes: { '/work/lib/sum.mjs': withBom },
    });

    await runReproPackCommand(
      {
        ...OUTPUT,
        capsulePath: '/work/run.capsule.json',
        entry: 'main.mjs',
        files: ['lib/sum.mjs'],
        root: '/work',
      },
      io
    );

    const parsed = parseReproEnvelope(state.stdout);
    expect(parsed.ok && parsed.value.files[0]?.content).toBe(`\uFEFF${HELPER}`);
  });

  it.each<
    [
      string,
      Record<string, string>,
      Partial<Parameters<typeof runReproPackCommand>[0]>,
      number,
      string,
    ]
  >([
    [
      'a file outside the root',
      capsuleFiles,
      { files: ['../secret.mjs'] },
      CLI_EXIT_CODES.userInputError,
      'invalid-path',
    ],
    [
      'a missing file',
      capsuleFiles,
      { files: ['lib/missing.mjs'] },
      CLI_EXIT_CODES.userInputError,
      'file-not-found',
    ],
    [
      'an entry with an ambiguous module format',
      capsuleFiles,
      { entry: 'main.js' },
      CLI_EXIT_CODES.userInputError,
      'invalid-entry',
    ],
    [
      'a TypeScript capsule',
      { '/work/run.capsule.json': JSON.stringify(FIXTURE_FULL_TS) },
      {},
      CLI_EXIT_CODES.unsupportedCapability,
      'unsupported-language',
    ],
    [
      'a Node major below 18',
      capsuleFiles,
      { nodeMajor: 17 },
      CLI_EXIT_CODES.unsupportedCapability,
      'unsupported-runtime',
    ],
  ])(
    'refuses %s without printing an envelope',
    async (_name, files, overrides, exitCode, reason) => {
      const { io, state } = createFakeIo({ files });

      const code = await runReproPackCommand(
        {
          ...JSON_OUTPUT,
          capsulePath: '/work/run.capsule.json',
          entry: 'main.mjs',
          files: [],
          root: '/work',
          ...overrides,
        },
        io
      );

      expect(code).toBe(exitCode);
      expect(JSON.parse(state.stdout)).toMatchObject({ ok: false, reason });
    }
  );
});

describe('lingua repro review', () => {
  it('reports the approval token, required controls and the missing backend as JSON', async () => {
    const json = await envelopeJson();
    const { io, state } = createFakeIo({ files: { '/work/repro.json': json } });

    const code = await runReproReviewCommand(
      { ...JSON_OUTPUT, envelopePath: '/work/repro.json', backends: [] },
      io
    );

    expect(code).toBe(CLI_EXIT_CODES.ok);
    const body = JSON.parse(state.stdout) as {
      approval: { contentDigest: string; policyDigest: string; token: string };
      backend: unknown;
      missingControls: string[];
      requiredControls: string[];
      files: Array<{ path: string }>;
    };
    expect(body.approval.token).toBe(await computeReproApprovalToken(body.approval));
    expect(body.backend).toBeNull();
    expect(body.requiredControls).toEqual(MANDATORY_CONTROLS);
    expect(body.missingControls).toEqual(MANDATORY_CONTROLS);
    expect(body.files.map(file => file.path)).toEqual(['lib/sum.mjs']);
  });

  it('prints the run command with the token for a person', async () => {
    const json = await envelopeJson();
    const token = await reviewToken(json);
    const { io, state } = createFakeIo({ files: { '/work/repro.json': json } });

    const code = await runReproReviewCommand(
      {
        ...OUTPUT,
        envelopePath: '/work/repro.json',
        backends: [],
        resolveNode: async () => NODE_24,
      },
      io
    );

    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toContain('entry    main.mjs\n');
    expect(state.stdout).toContain('runtime  node 24.21.0\n');
    expect(state.stdout).toContain('network  deny');
    expect(state.stdout).toMatch(/backend {2}none on \S+ \S+; run refuses before launch/u);
    expect(state.stdout).toContain(`approve  lingua repro run /work/repro.json --approve ${token}`);
  });

  it('quotes an envelope path a shell would split in the approve hint', async () => {
    const json = await envelopeJson();
    const token = await reviewToken(json);
    const { io, state } = createFakeIo({ files: { "/work/bug repro's.json": json } });

    await runReproReviewCommand({ ...OUTPUT, envelopePath: "/work/bug repro's.json" }, io);

    expect(state.stdout).toContain(
      `approve  lingua repro run '/work/bug repro'\\''s.json' --approve ${token}`
    );
  });

  it.each<[string, ReproNodeRuntime | null, string]>([
    [
      'another Node major',
      { path: '/opt/node22/bin/node', version: '22.11.0' },
      'runtime  node 24 requested; found 22.11.0; run refuses before launch',
    ],
    [
      'no Node.js at all',
      null,
      'runtime  node 24 requested; Node.js not found; run refuses before launch',
    ],
  ])('warns before approval when the host has %s', async (_name, node, line) => {
    const json = await envelopeJson();
    const { io, state } = createFakeIo({ files: { '/work/repro.json': json } });

    await runReproReviewCommand(
      { ...OUTPUT, envelopePath: '/work/repro.json', backends: [], resolveNode: async () => node },
      io
    );

    expect(state.stdout).toContain(line);
  });

  it('names the controls a probed backend cannot enforce', async () => {
    const json = await envelopeJson();
    const { io, state } = createFakeIo({ files: { '/work/repro.json': json } });

    await runReproReviewCommand(
      {
        ...OUTPUT,
        envelopePath: '/work/repro.json',
        backends: [backend({ 'network-deny': 'unsupported' })],
      },
      io
    );

    expect(state.stdout).toContain(
      'backend  fake-backend 1 cannot enforce network-deny; run refuses before launch'
    );
  });

  it('refuses an envelope whose file no longer matches its hash', async () => {
    const tampered = (await envelopeJson()).replace('a + b', 'a - b');
    const { io, state } = createFakeIo({ files: { '/work/repro.json': tampered } });

    const code = await runReproReviewCommand(
      { ...JSON_OUTPUT, envelopePath: '/work/repro.json' },
      io
    );

    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(JSON.parse(state.stdout)).toMatchObject({ ok: false, reason: 'hash-mismatch' });
  });
});

describe('lingua repro run', () => {
  async function run(overrides: Partial<ReproRunArgs> & { approve?: string } = {}) {
    const json = await envelopeJson();
    const token = await reviewToken(json);
    const { io, state } = createFakeIo({ files: { '/work/repro.json': json } });
    const code = await runReproRunCommand(runArgs({ approve: token, ...overrides }), io);
    const body = JSON.parse(state.stdout) as {
      ok: boolean;
      reason: string;
      detail: string;
      receipt: unknown;
      verdict: { overall: string };
    };
    return { code, body, token };
  }

  it('refuses before launch when no backend is available', async () => {
    const { code, body } = await run();

    expect(code).toBe(CLI_EXIT_CODES.unsupportedCapability);
    expect(body).toMatchObject({ ok: false, reason: 'backend-unavailable' });
    expect(body.detail).toContain('nothing was run');
    expect(body.verdict.overall).toBe('refused');
    const receipt = parseReproReceipt(JSON.stringify(body.receipt));
    expect(receipt).toMatchObject({
      ok: true,
      value: {
        launch: 'refused',
        refusalReason: 'backend-unavailable',
        missingControls: [],
        createdAt: '2026-10-29T12:00:00.000Z',
        host: { lingua: '1.6.2', runtime: null, backend: null },
      },
    });
  });

  it('refuses with the approval-invalid receipt when the token is stale', async () => {
    const { code, body } = await run({ approve: '0'.repeat(64) });

    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(body.reason).toBe('approval-invalid');
    expect(parseReproReceipt(JSON.stringify(body.receipt))).toMatchObject({
      ok: true,
      value: { refusalReason: 'approval-invalid', missingControls: [] },
    });
  });

  it('accepts a token pasted in uppercase with surrounding spaces', async () => {
    const json = await envelopeJson();
    const token = await reviewToken(json);
    const { io, state } = createFakeIo({ files: { '/work/repro.json': json } });

    await runReproRunCommand(runArgs({ approve: `  ${token.toUpperCase()}\n` }), io);

    expect(JSON.parse(state.stdout)).toMatchObject({ reason: 'backend-unavailable' });
  });

  it('labels the recorded OS release as the kernel release', async () => {
    const { body } = await run();

    expect(body.receipt).toMatchObject({
      host: { os: expect.stringMatching(/^\S+ kernel \S+$/u) },
    });
  });

  it('lists the controls a probed backend cannot enforce', async () => {
    const { code, body } = await run({
      backends: [backend({ 'network-deny': 'unsupported', 'process-limit': 'sampled' })],
    });

    expect(code).toBe(CLI_EXIT_CODES.unsupportedCapability);
    expect(body.reason).toBe('unenforceable');
    expect(parseReproReceipt(JSON.stringify(body.receipt))).toMatchObject({
      ok: true,
      value: {
        refusalReason: 'unenforceable',
        missingControls: ['network-deny', 'process-limit'],
        host: { backend: { id: 'fake-backend', version: '1' } },
      },
    });
  });

  it('refuses before staging when the host Node major differs from the request', async () => {
    const fake = backend();
    const { code, body } = await run({
      backends: [fake],
      resolveNode: async () => ({ path: '/opt/node22/bin/node', version: '22.11.0' }),
    });

    expect(code).toBe(CLI_EXIT_CODES.unsupportedCapability);
    expect(body.reason).toBe('runtime-unavailable');
    expect(body.detail).toBe('node 24 requested; found 22.11.0; nothing was run.');
    expect(fake.launches).toEqual([]);
  });

  it('binds the receipt to the digests review printed', async () => {
    const json = await envelopeJson();
    const { io: reviewIo, state: reviewState } = createFakeIo({
      files: { '/work/repro.json': json },
    });
    await runReproReviewCommand(
      {
        ...JSON_OUTPUT,
        envelopePath: '/work/repro.json',
        backends: [],
        resolveNode: async () => NODE_24,
      },
      reviewIo
    );
    const { approval } = JSON.parse(reviewState.stdout) as {
      approval: { contentDigest: string; policyDigest: string; token: string };
    };
    const { io, state } = createFakeIo({ files: { '/work/repro.json': json } });

    await runReproRunCommand(runArgs({ approve: approval.token }), io);

    expect((JSON.parse(state.stdout) as { receipt: unknown }).receipt).toMatchObject({
      contentDigest: approval.contentDigest,
      approvedPolicyDigest: approval.policyDigest,
    });
  });

  it('explains the refusal on stderr and prints nothing on stdout for a person', async () => {
    const json = await envelopeJson();
    const token = await reviewToken(json);
    const { io, state } = createFakeIo({ files: { '/work/repro.json': json } });

    await runReproRunCommand(runArgs({ ...OUTPUT, approve: token }), io);

    expect(state.stdout).toBe('');
    expect(state.stderr).toContain('lingua repro run: error[backend-unavailable]');
  });
});

describe('lingua repro run with a backend that launches', () => {
  let stagingParent: string;
  beforeEach(async () => {
    stagingParent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'repro-run-test-')));
  });
  afterEach(async () => {
    await rm(stagingParent, { recursive: true, force: true });
  });

  async function launchRun(
    fake: ReturnType<typeof backend>,
    output: { json: boolean; quiet: boolean } = JSON_OUTPUT
  ) {
    const json = await envelopeJson();
    const token = await reviewToken(json);
    const { io, state } = createFakeIo({ files: { '/work/repro.json': json } });
    const code = await runReproRunCommand(
      runArgs({ ...output, approve: token, backends: [fake], stagingParent }),
      io
    );
    return { code, state };
  }

  it('runs the staged entry and reports a launched receipt that passes', async () => {
    const fake = backend(undefined, async request => {
      expect(await readFile(request.staging.entry, 'utf8')).toBe(FIXTURE_MINIMAL_JS.source.content);
      expect(await readFile(path.join(request.staging.inputs, 'lib', 'sum.mjs'), 'utf8')).toBe(
        HELPER
      );
      return executionResult();
    });

    const { code, state } = await launchRun(fake);

    expect(code).toBe(CLI_EXIT_CODES.ok);
    const body = JSON.parse(state.stdout) as {
      ok: boolean;
      receipt: unknown;
      verdict: unknown;
      stdout: string;
    };
    expect(body).toMatchObject({
      ok: true,
      stdout: '3\n',
      verdict: { overall: 'pass', output: 'pass', compliance: 'not-observed' },
    });
    expect(parseReproReceipt(JSON.stringify(body.receipt))).toMatchObject({
      ok: true,
      value: {
        launch: 'launched',
        comparison: 'pass',
        host: { runtime: 'node 24.21.0', backend: { id: 'fake-backend', version: '1' } },
        execution: { status: 'success', exitCode: 0, outputTruncated: false },
      },
    });
    expect(fake.launches[0]?.node).toEqual(NODE_24);
    expect(fake.launches[0]?.policy).toEqual(DEFAULT_REPRO_REQUEST);
  });

  it('removes the private staging root after the run', async () => {
    const fake = backend();

    await launchRun(fake);

    expect(fake.launches[0]?.staging.root.startsWith(stagingParent)).toBe(true);
    expect(await readdir(stagingParent)).toEqual([]);
  });

  it('removes the staging root even when the backend throws', async () => {
    const fake = backend(undefined, async () => {
      throw new Error('sandbox crashed');
    });

    await expect(launchRun(fake)).rejects.toThrow('sandbox crashed');
    expect(await readdir(stagingParent)).toEqual([]);
  });

  it.each<[string, Partial<CliExecutionResult>, number, string]>([
    ['different output', { stdout: '4\n' }, CLI_EXIT_CODES.verificationFailed, 'fail'],
    [
      'a timeout',
      { status: 'timeout', exitCode: null, signal: 'SIGKILL', reason: 'timeout' },
      CLI_EXIT_CODES.verificationInconclusive,
      'incomplete',
    ],
    [
      'clipped output',
      { truncated: { stdout: true, stderr: false } },
      CLI_EXIT_CODES.verificationInconclusive,
      'incomplete',
    ],
  ])('maps %s to its verdict and exit code', async (_name, overrides, exitCode, overall) => {
    const { code, state } = await launchRun(
      backend(undefined, async () => executionResult(overrides))
    );

    expect(code).toBe(exitCode);
    expect(JSON.parse(state.stdout)).toMatchObject({ verdict: { overall } });
  });

  it('prints the program output and the verdict for a person', async () => {
    const { state } = await launchRun(backend(), OUTPUT);

    expect(state.stdout).toBe('3\n');
    expect(state.stderr).toBe(
      'lingua repro run: pass (output pass, enforcement enforced, compliance not-observed, evidence unavailable)\n'
    );
  });
});
