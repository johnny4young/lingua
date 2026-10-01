import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runVerifyCapsuleSuiteCommand } from '../../../src/cli/commands/capsuleSuite';
import { executeCliPlan } from '../../../src/cli/runtime/execution';
import { FIXTURE_MINIMAL_JS } from '../../shared/runCapsule.fixtures';
import { createFakeIo } from '../io-fake';
vi.mock('../../../src/cli/runtime/execution', async original => ({
  ...(await original<typeof import('../../../src/cli/runtime/execution')>()),
  executeCliPlan: vi.fn(),
}));
afterEach(() => vi.restoreAllMocks());
it('caps each case by the remaining total budget and marks unexecuted cases inconclusive', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lingua-budget-'));
  let clock = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  vi.mocked(executeCliPlan).mockImplementation(async plan => {
    clock += 200_000;
    return {
      status: 'success',
      target: plan.displayTarget,
      runtime: plan.runtime,
      durationMs: 0,
      exitCode: 0,
      signal: null,
      stdout: FIXTURE_MINIMAL_JS.result.stdout!,
      stderr: '',
    };
  });
  try {
    await writeFile(path.join(dir, 'hello.js'), FIXTURE_MINIMAL_JS.source.content);
    const file = path.join(dir, 'suite.json');
    await writeFile(
      file,
      JSON.stringify({
        kind: 'lingua-regression-suite',
        suiteVersion: 1,
        cases: Array.from({ length: 3 }, (_, i) => ({
          id: `case-${i}`,
          name: 'case',
          target: 'hello.js',
          baseline: FIXTURE_MINIMAL_JS,
        })),
      })
    );
    const { io, state } = createFakeIo();
    const exit = await runVerifyCapsuleSuiteCommand(
      { filePath: file, rootDirectory: dir, timeoutMs: 300_000, env: [], json: true, quiet: false },
      io
    );
    expect(exit).toBe(6);
    expect(JSON.parse(state.stdout)).toMatchObject({
      ok: false,
      verdict: 'inconclusive',
      summary: { total: 3, passed: 2, skipped: 1, inconclusive: 1 },
      cases: [
        { verdict: 'pass' },
        { verdict: 'pass' },
        { skipped: true, reason: 'suite-budget-exhausted' },
      ],
    });
    expect(executeCliPlan).toHaveBeenCalledTimes(2);
    expect(vi.mocked(executeCliPlan).mock.calls.map(([, options]) => options.timeoutMs)).toEqual([
      300_000, 100_000,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
