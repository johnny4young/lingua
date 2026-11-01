import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAndCollect } from '@/runtime/execute/runAndCollect';
import { useResultStore } from '@/stores/resultStore';
import type { ConsoleOutput, ExecutionContext } from '@/types/execution';

const initial = useResultStore.getState();
afterEach(() => useResultStore.setState(initial, true));

describe('streamed progress', () => {
  it('shows one line per progress bar while the run streams', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => (release = resolve));
    const bar = (value: number): ConsoleOutput => ({ type: 'log', args: [`import ${value * 100}%`], line: 1, payload: [{ kind: 'progress', id: 'r:1', label: 'import', value }] });
    const runner = {
      execute: vi.fn(async (_code: string, context?: ExecutionContext) => {
        for (const value of [0, 0.5, 1]) context?.onConsole?.(bar(value));
        await gate;
        return { stdout: [], stderr: [], executionTime: 1 };
      }),
    };
    const runConsole = { add: vi.fn(), flush: vi.fn(), count: () => 0 };
    const pending = runAndCollect(runner, { id: 't', name: 'a.js', language: 'javascript', content: 'x', isDirty: false }, { context: { language: 'javascript' }, deadlineTimeoutMs: undefined, clearsTimeoutOverride: false }, runConsole as never);
    await vi.waitFor(() => expect(useResultStore.getState().lineResults.length).toBeGreaterThan(0));
    expect(useResultStore.getState().lineResults.map(row => row.value)).toEqual(['import 100%']);
    release();
    await pending;
  });
});
