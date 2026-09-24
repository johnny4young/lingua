import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireRunner } from '../../../src/renderer/runtime/execute/prepareRun';
import { resolveRunPlan } from '../../../src/renderer/runtime/execute/resolveRunPlan';
import { beginManualRun } from '../../../src/renderer/runtime/manualRunSession';
import { useResultStore } from '../../../src/renderer/stores/resultStore';
import type { FileTab } from '../../../src/renderer/types/editor';
import type { ExecutionResult } from '../../../src/renderer/types/execution';

const bridges = vi.hoisted(() => ({
  python: { execute: vi.fn(), stop: vi.fn() },
  go: { execute: vi.fn(), stop: vi.fn() },
  rust: { execute: vi.fn(), stop: vi.fn() },
}));
vi.mock('../../../src/renderer/runtime/pythonDebuggerBridge', () => ({
  executePythonDebugSession: bridges.python.execute,
  stopActivePythonDebugger: bridges.python.stop,
}));
vi.mock('../../../src/renderer/runtime/goDebuggerBridge', () => ({
  executeGoDebugSession: bridges.go.execute,
  stopActiveGoDebugger: bridges.go.stop,
}));
vi.mock('../../../src/renderer/runtime/rustDebuggerBridge', () => ({
  executeRustDebugSession: bridges.rust.execute,
  stopActiveRustDebugger: bridges.rust.stop,
}));

const initialResultState = useResultStore.getState();
beforeEach(() => {
  vi.clearAllMocks();
  useResultStore.setState(initialResultState, true);
});
afterEach(() => {
  useResultStore.getState().manualRunSession?.cancel();
  useResultStore.setState(initialResultState, true);
});

describe.each(['python', 'go', 'rust'] as const)('%s debugger ownership', language => {
  const tab: FileTab = { id: 'debug-owned', name: 'debug', language, content: '', isDirty: false };

  it('does not start the adapter after cancellation during its lazy import', async () => {
    const session = beginManualRun(tab, true)!;
    const runner = await acquireRunner(tab, resolveRunPlan(tab, { debug: true }), { session });
    const pending = runner!.execute('');
    session.cancel();
    await expect(pending).resolves.toMatchObject({ cancelled: true });
    expect(bridges[language].execute).not.toHaveBeenCalled();
    expect(bridges[language].stop).not.toHaveBeenCalled();
  });

  it('registers Stop before starting and never stops again after ownership is revoked', async () => {
    let finish!: (result: ExecutionResult) => void;
    bridges[language].execute.mockImplementation(
      () =>
        new Promise<ExecutionResult>(resolve => {
          finish = resolve;
        })
    );
    const session = beginManualRun(tab, true)!;
    const runner = await acquireRunner(tab, resolveRunPlan(tab, { debug: true }), { session });
    const pending = runner!.execute('');
    await vi.waitFor(() => expect(bridges[language].execute).toHaveBeenCalledOnce());
    session.cancel();
    expect(bridges[language].stop).toHaveBeenCalledOnce();
    const next = beginManualRun(tab, true)!;
    session.cancel();
    finish({ stdout: [], stderr: [], executionTime: 0, cancelled: true });
    await pending;
    expect(bridges[language].stop).toHaveBeenCalledOnce();
    expect(next.isCurrent()).toBe(true);
    next.finish();
  });
});
