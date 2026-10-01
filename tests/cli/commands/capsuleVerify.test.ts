import { describe, expect, it } from 'vitest';
import { runVerifyCapsuleCommand } from '../../../src/cli/commands/capsuleVerify';
import { computeContentHash, type RunCapsuleV1 } from '../../../src/shared/runCapsule';
import { FIXTURE_MINIMAL_JS } from '../../shared/runCapsule.fixtures';
import { createFakeIo } from '../io-fake';

async function verify(capsule: RunCapsuleV1, timeoutMs = 2000) {
  const { io, state } = createFakeIo({ files: { '/tmp/baseline.json': JSON.stringify(capsule) } });
  const exit = await runVerifyCapsuleCommand(
    { filePath: '/tmp/baseline.json', json: true, quiet: false, env: [], timeoutMs },
    io
  );
  return { exit, body: JSON.parse(state.stdout), stderr: state.stderr };
}
async function source(content: string): Promise<RunCapsuleV1> {
  return {
    ...structuredClone(FIXTURE_MINIMAL_JS),
    source: { content, contentHash: await computeContentHash(content) },
  };
}
describe('strict Capsule verification', () => {
  it('passes exact recorded source and exposes both runtimes', async () => {
    const { exit, body } = await verify(FIXTURE_MINIMAL_JS);
    expect(exit).toBe(0);
    expect(body).toMatchObject({
      ok: true,
      verdict: 'pass',
      sourceMode: 'captured',
      comparison: { matches: true },
      recordedRuntime: FIXTURE_MINIMAL_JS.environment.runner,
      actualRuntime: 'node-worker',
    });
  });
  it.each(['stdout', 'stderr'] as const)(
    'fails drift in %s without normalization',
    async stream => {
      const capsule = structuredClone(FIXTURE_MINIMAL_JS);
      capsule.result[stream] = 'different\r\n';
      const { exit, body } = await verify(capsule);
      expect(exit).toBe(5);
      expect(body).toMatchObject({ ok: false, verdict: 'fail', comparison: { [stream]: false } });
    }
  );
  it('returns runtime failure rather than passing a failed execution', async () => {
    const { exit, body } = await verify(await source('throw new Error("fixture")'));
    expect(exit).toBe(2);
    expect(body).toMatchObject({ ok: false, verdict: 'fail', run: { status: 'error' } });
  });
  it('refuses a modified hash before spawning', async () => {
    const capsule = structuredClone(FIXTURE_MINIMAL_JS);
    capsule.source.content = 'throw new Error("MUST NOT EXECUTE")';
    const { exit, body } = await verify(capsule);
    expect(exit).toBe(1);
    expect(body.reason).toBe('content-hash-mismatch');
    expect(body.run).toBeUndefined();
  });
  it.each(['error', 'timeout', 'stopped'] as const)(
    'refuses %s baselines before spawning',
    async status => {
      const capsule = structuredClone(FIXTURE_MINIMAL_JS);
      capsule.result.status = status;
      const { exit, body } = await verify(capsule);
      expect(exit).toBe(6);
      expect(body.verdict).toBe('inconclusive');
      expect(body.run).toBeUndefined();
    }
  );
  it.each(['source.content', 'input.stdin', 'result.stdout', 'result.stderr'])(
    'refuses incomplete %s evidence',
    async field => {
      const capsule = structuredClone(FIXTURE_MINIMAL_JS);
      capsule.privacy.omittedFields = [field];
      expect((await verify(capsule)).body).toMatchObject({
        ok: false,
        verdict: 'inconclusive',
        reason: 'incomplete-baseline',
      });
    }
  );
  it.each(['lineResults', 'richOutputs'] as const)('does not silently ignore %s', async field => {
    const capsule = structuredClone(FIXTURE_MINIMAL_JS);
    capsule.result[field] = [{ fixture: true }];
    expect((await verify(capsule)).exit).toBe(6);
  });
  it('allows absent streams as complete empty streams', async () => {
    const capsule = await source('');
    delete capsule.result.stdout;
    delete capsule.result.stderr;
    expect((await verify(capsule)).body).toMatchObject({
      verdict: 'pass',
      comparison: { matches: true },
    });
  });
  it('truncation has typed metadata and cannot produce a pass', async () => {
    const capsule = await source('process.stdout.write("x".repeat(1048577));');
    const { exit, body } = await verify(capsule);
    expect(exit).toBe(6);
    expect(body).toMatchObject({
      ok: false,
      verdict: 'inconclusive',
      run: { truncated: { stdout: true, stderr: false } },
    });
  });
  it('a literal truncation-looking string is ordinary verifiable output', async () => {
    const capsule = await source('console.log("[output truncated by Lingua CLI]");');
    capsule.result.stdout = '[output truncated by Lingua CLI]\n';
    expect((await verify(capsule)).exit).toBe(0);
  });
  it('times out with a non-success verdict', async () => {
    const { exit, body } = await verify(await source('setInterval(() => {}, 1000);'), 100);
    expect(exit).toBe(2);
    expect(body).toMatchObject({ ok: false, verdict: 'inconclusive', run: { status: 'timeout' } });
  });
  it('Browser preview is unsupported, not a successful Node replay', async () => {
    const capsule = structuredClone(FIXTURE_MINIMAL_JS);
    capsule.tab.runtimeMode = 'browser-preview';
    const { exit, body } = await verify(capsule);
    expect(exit).toBe(3);
    expect(body.verdict).toBe('inconclusive');
  });
  it('does not allow explicit environment injection hooks', async () => {
    const { io, state } = createFakeIo({ files: { 'b.json': JSON.stringify(FIXTURE_MINIMAL_JS) } });
    expect(
      await runVerifyCapsuleCommand(
        {
          filePath: 'b.json',
          json: true,
          quiet: false,
          env: [{ key: 'NODE_OPTIONS', value: '--require forbidden' }],
        },
        io
      )
    ).toBe(1);
    expect(JSON.parse(state.stdout).run).toBeUndefined();
  });
  it('keeps a genuinely unavailable toolchain inconclusive with exit 3', async () => {
    const previous = process.env.PATH;
    process.env.PATH = '/__lingua_missing_toolchain_fixture__';
    try {
      const capsule = await source('print(3)');
      capsule.tab.language = 'lua';
      const { exit, body } = await verify(capsule);
      expect(exit).toBe(3);
      expect(body).toMatchObject({
        ok: false,
        verdict: 'inconclusive',
        reason: 'missing-runtime',
        run: { reason: 'missing-runtime' },
      });
    } finally {
      if (previous === undefined) delete process.env.PATH;
      else process.env.PATH = previous;
    }
  });
  it('retains typed stderr truncation even on a nonzero exit', async () => {
    const capsule = await source(
      'process.stderr.write("x".repeat(1048577)); process.exitCode = 1;'
    );
    const { exit, body } = await verify(capsule);
    expect(exit).toBe(2);
    expect(body).toMatchObject({
      ok: false,
      verdict: 'inconclusive',
      run: { truncated: { stdout: false, stderr: true } },
    });
  });
});
