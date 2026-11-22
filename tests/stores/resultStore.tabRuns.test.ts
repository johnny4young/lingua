import { afterEach, describe, expect, it } from 'vitest';
import { nextTabRunNumber, TAB_RUN_LOG_CAP, useResultStore } from '@/stores/resultStore';

const initial = useResultStore.getState();

afterEach(() => useResultStore.setState(initial, true));

describe('tab run log', () => {
  it('numbers settled runs per tab and publishes the termination', () => {
    const store = useResultStore.getState();
    expect(nextTabRunNumber(store, 'a')).toBe(1);
    expect(store.settleTabRun('a', { kind: 'success' }, { durationMs: 4 })).toBe(1);
    expect(useResultStore.getState().settleTabRun('a', { kind: 'error' }, { durationMs: null, line: 3 })).toBe(2);
    expect(useResultStore.getState().settleTabRun('b', { kind: 'stopped' }, { durationMs: 9, publish: false })).toBe(1);

    const state = useResultStore.getState();
    expect(state.tabRuns.a).toEqual({
      count: 2,
      runs: [
        { kind: 'success', number: 1, durationMs: 4 },
        { kind: 'error', number: 2, durationMs: null, line: 3 },
      ],
    });
    expect(state.runTermination).toEqual({ kind: 'error' });
    expect(nextTabRunNumber(state, 'a')).toBe(3);
  });

  it('survives tab switches and caps the kept runs, never the count', () => {
    for (let index = 0; index < TAB_RUN_LOG_CAP + 3; index += 1) {
      useResultStore.getState().settleTabRun('a', { kind: 'success' }, { durationMs: index });
    }
    useResultStore.getState().clear();
    useResultStore.getState().clearVisibleResults();
    const log = useResultStore.getState().tabRuns.a!;
    expect(log.count).toBe(TAB_RUN_LOG_CAP + 3);
    expect(log.runs).toHaveLength(TAB_RUN_LOG_CAP);
    expect(log.runs[0]!.number).toBe(4);
  });
});

describe('stopping a manual run', () => {
  it('logs the stop for the tab so the run meter shows it', async () => {
    const { beginManualRun } = await import('@/runtime/manualRunSession');
    const tab = { id: 'stop-tab', name: 'a.js', language: 'javascript', content: '', isDirty: false };
    const session = beginManualRun(tab as never)!;
    useResultStore.setState({ manualRunSession: session, isManualRunning: true });
    session.cancel();
    const state = useResultStore.getState();
    expect(state.tabRuns['stop-tab']?.runs.at(-1)).toMatchObject({ number: 1, kind: 'stopped' });
    expect(state.runTermination).toEqual({ kind: 'stopped' });
  });
});

describe('a run failure after the runner settled', () => {
  it('publishes the error without counting the run twice', async () => {
    const { publishRunFailure } = await import('@/runtime/execute/publishRunResult');
    const tab = { id: 'fail-tab', name: 'a.js', language: 'javascript', content: '', isDirty: false };
    useResultStore.getState().settleTabRun('fail-tab', { kind: 'success' }, { durationMs: 3 });
    await publishRunFailure(tab as never, { recordHistory: false } as never, new Error('boom'), undefined, () => true, () => true, true);
    expect(useResultStore.getState().tabRuns['fail-tab']?.count).toBe(1);
    expect(useResultStore.getState().runTermination).toEqual({ kind: 'error' });
    await publishRunFailure(tab as never, { recordHistory: false } as never, new Error('boom'));
    expect(useResultStore.getState().tabRuns['fail-tab']?.count).toBe(2);
  });
});
