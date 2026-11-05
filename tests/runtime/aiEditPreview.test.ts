import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const result = (stdout: string, error: string | null = null) => ({
    stdout: stdout ? [{ type: 'log', args: [stdout] }] : [],
    stderr: [],
    error: error ? { message: error } : undefined,
    executionTime: 12,
  });
  const state = { failInit: false };
  const runners: Array<{ kind: string; execute: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; init: ReturnType<typeof vi.fn> }> = [];
  const makeRunner = (kind: string) => {
    const runner = {
      kind,
      init: vi.fn(async () => {
        if (state.failInit) throw new Error('no worker');
      }),
      execute: vi.fn(async (code: string) => (code.includes('throw') ? result('', 'boom') : result(`${kind}:${code}`))),
      stop: vi.fn(),
    };
    runners.push(runner);
    return runner;
  };
  return { runners, makeRunner, state };
});

vi.mock('../../src/renderer/runners/javascript', () => ({
  JavaScriptRunner: function JavaScriptRunner() {
    return mocks.makeRunner('js');
  },
}));
vi.mock('../../src/renderer/runners/typescript', () => ({
  TypeScriptRunner: function TypeScriptRunner() {
    return mocks.makeRunner('ts');
  },
}));
vi.mock('../../src/renderer/runners/python', () => ({
  PythonRunner: function PythonRunner(isolated: boolean) {
    return Object.assign(mocks.makeRunner('py'), { isolated });
  },
}));

import { comparePreview, runEditPreview, valueChanges, type PreviewRun } from '../../src/renderer/runtime/aiEditPreview';


describe('runEditPreview', () => {
  beforeEach(() => {
    mocks.runners.length = 0;
  });

  it('runs both versions on a runner of its own, blocked from the network, then stops it', async () => {
    const preview = await runEditPreview('javascript', 'a', 'b');
    expect(preview).toEqual({
      kind: 'ran',
      before: { error: null, stdout: 'js:a', executionTime: 12, values: new Map([[1, 'js:a']]) },
      after: { error: null, stdout: 'js:b', executionTime: 12, values: new Map([[1, 'js:b']]) },
    });
    expect(mocks.runners).toHaveLength(1);
    const [runner] = mocks.runners;
    expect(runner!.init).toHaveBeenCalledTimes(1);
    for (const call of runner!.execute.mock.calls) expect(call[1]).toMatchObject({ timeout: 5_000, blockNetwork: true });
    expect(runner!.stop).toHaveBeenCalledTimes(1);
  });

  it('runs the change in its own scope', async () => {
    await runEditPreview('python', 'x', 'y');
    const [runner] = mocks.runners;
    expect(runner).toMatchObject({ kind: 'py', isolated: true });
    const scopes = runner!.execute.mock.calls.map(call => (call[1] as { scopeId: string }).scopeId);
    expect(new Set(scopes).size).toBe(2);
  });

  it('reports a runner that rejects as a failed run and always stops it', async () => {
    const preview = await runEditPreview('typescript', 'throw a', 'b');
    expect(preview).toMatchObject({ kind: 'ran', before: { error: 'boom' } });
    expect(mocks.runners[0]!.stop).toHaveBeenCalledTimes(1);

    mocks.runners.length = 0;
    const pending = runEditPreview('python', 'x', 'y');
    mocks.runners[0]!.execute.mockRejectedValueOnce(new Error('worker died'));
    expect(await pending).toMatchObject({ kind: 'ran', before: { error: 'worker died' }, after: { stdout: 'py:y' } });
    expect(mocks.runners[0]!.stop).toHaveBeenCalledTimes(1);

    mocks.runners.length = 0;
    mocks.state.failInit = true;
    try {
      expect(await runEditPreview('javascript', 'a', 'b')).toMatchObject({ kind: 'ran', before: { error: 'no worker' }, after: { error: 'no worker' } });
    } finally {
      mocks.state.failInit = false;
    }
    expect(mocks.runners[0]!.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps the last value of a line that runs more than once', async () => {
    const pending = runEditPreview('javascript', 'a', 'b');
    const loop = { stdout: [{ type: 'log', args: ['1'], line: 2 }, { type: 'log', args: ['2'], line: 2 }], stderr: [], executionTime: 1 };
    mocks.runners[0]!.execute.mockResolvedValueOnce(loop);
    expect(await pending).toMatchObject({ kind: 'ran', before: { values: new Map([[2, '2']]) } });
  });

  it('skips languages without a sandboxed runner', async () => {
    expect(await runEditPreview('go', 'a', 'b')).toEqual({ kind: 'skipped' });
    expect(mocks.runners).toHaveLength(0);
  });
});

describe('comparePreview', () => {
  const run = (error: string | null, stdout = '') => ({ error, stdout, executionTime: 1, values: new Map() });

  it('counts a fixed error', () => {
    expect(comparePreview(run('boom'), run(null))).toEqual({ fixed: 1, introduced: 0, stdoutChanged: false });
    expect(comparePreview(run(null), run(null))).toEqual({ fixed: 0, introduced: 0, stdoutChanged: false });
  });

  it('counts a new error, including a different one', () => {
    expect(comparePreview(run(null), run('boom'))).toMatchObject({ fixed: 0, introduced: 1 });
    expect(comparePreview(run('a'), run('b'))).toMatchObject({ fixed: 0, introduced: 1 });
    expect(comparePreview(run('a'), run('a'))).toMatchObject({ fixed: 0, introduced: 0 });
  });

  it('notices changed output', () => {
    expect(comparePreview(run(null, '1'), run(null, '2')).stdoutChanged).toBe(true);
    expect(comparePreview(run(null, '1'), run(null, '1')).stdoutChanged).toBe(false);
  });
});

describe('valueChanges', () => {
  const run = (values: Record<number, string>): PreviewRun => ({ error: null, stdout: '', executionTime: 1, values: new Map(Object.entries(values).map(([line, value]) => [Number(line), value])) });

  it('lists only the lines whose value changed', () => {
    const edit = { before: 'a\n', selected: 'b', proposal: 'c' };
    expect(valueChanges(run({ 1: '1', 2: '2', 3: '3' }), run({ 1: '1', 2: '20', 3: '3' }), edit)).toEqual([{ line: 2, before: '2', after: '20' }]);
    expect(valueChanges(run({ 1: '1' }), run({ 1: '1' }), edit)).toEqual([]);
  });

  it('shifts the lines below the selection by the lines the change adds or removes', () => {
    const grow = { before: 'a\n', selected: 'b', proposal: 'b1\nb2' };
    expect(valueChanges(run({ 3: 'x' }), run({ 4: 'x' }), grow)).toEqual([]);
    expect(valueChanges(run({ 3: 'x' }), run({ 4: 'y' }), grow)).toEqual([{ line: 4, before: 'x', after: 'y' }]);
    const shrink = { before: '', selected: 'a\nb\nc', proposal: 'a' };
    expect(valueChanges(run({ 5: 'x' }), run({ 3: 'x' }), shrink)).toEqual([]);
  });

  it('shows new lines, and values that went away, with no counterpart', () => {
    const edit = { before: '', selected: 'a', proposal: 'a\nb' };
    expect(valueChanges(run({}), run({ 2: '10' }), edit)).toEqual([{ line: 2, before: null, after: '10' }]);
    expect(valueChanges(run({ 1: '1' }), run({}), edit)).toEqual([{ line: 1, before: '1', after: null }]);
    const removed = { before: '', selected: 'a\nb', proposal: 'a' };
    expect(valueChanges(run({ 2: '2' }), run({}), removed)).toEqual([{ line: 1, before: '2', after: null }]);
  });
});
