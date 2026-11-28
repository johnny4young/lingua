import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAndCollect } from '@/runtime/execute/runAndCollect';
import { useResultStore } from '@/stores/resultStore';
import { useLiveRunStore } from '@/stores/liveRunStore';
import { useTimelineStore } from '@/stores/timelineStore';
import type { ConsoleOutput, ExecutionContext } from '@/types/execution';

const initial = useResultStore.getState();
afterEach(() => {
  useResultStore.setState(initial, true);
  useTimelineStore.setState({ recording: null, current: 0 });
});

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

  it('grows the recording of a Record run and reports its latest step as where the run is', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => (release = resolve));
    const step = (line: number, ms: number) => ({ line, frames: [], vars: [], ms });
    const runner = {
      execute: vi.fn(async (_code: string, context?: ExecutionContext) => {
        context?.onTimeline?.({ steps: [step(1, 0), step(3, 5)], ms: 12 });
        await gate;
        return { stdout: [], stderr: [], executionTime: 1 };
      }),
    };
    const runConsole = { add: vi.fn(), flush: vi.fn(), count: () => 0 };
    const tab = { id: 'py', name: 'a.py', language: 'python', content: 'x', isDirty: false };
    const pending = runAndCollect(runner, tab, { context: { language: 'python', record: true }, deadlineTimeoutMs: undefined, clearsTimeoutOverride: false }, runConsole as never);
    await vi.waitFor(() => expect(useTimelineStore.getState().recording?.steps).toHaveLength(2));
    expect(useTimelineStore.getState().recording).toMatchObject({ tabId: 'py', live: true, ms: 12, code: 'x' });
    expect(useLiveRunStore.getState().byTab.py?.live).toEqual({ line: 3, lineMs: 7, elapsedMs: 12, loops: [] });
    release();
    await pending;
    expect(useLiveRunStore.getState().byTab.py).toBeUndefined();
  });

  it('asks for no steps when the run does not record', async () => {
    const runner = { execute: vi.fn(async () => ({ stdout: [], stderr: [], executionTime: 1 })) };
    const runConsole = { add: vi.fn(), flush: vi.fn(), count: () => 0 };
    await runAndCollect(runner, { id: 't', name: 'a.js', language: 'javascript', content: 'x', isDirty: false }, { context: { language: 'javascript' }, deadlineTimeoutMs: undefined, clearsTimeoutOverride: false }, runConsole as never);
    expect(runner.execute.mock.calls[0]![1]).not.toHaveProperty('onTimeline');
  });
});
