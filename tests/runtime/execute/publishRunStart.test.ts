import { afterEach, describe, expect, it } from 'vitest';
import { publishRunStart } from '@/runtime/execute/publishRunResult';
import type { RunPlan } from '@/runtime/execute/resolveRunPlan';
import type { RunConsole } from '@/runtime/execute/runAndCollect';
import { useResultStore } from '@/stores/resultStore';
import type { FileTab } from '@/types/editor';

const initial = useResultStore.getState();
const tab = { id: 'a', name: 'scratch.py', content: 'x = 1', language: 'python' } as FileTab;
const plan: RunPlan = { mode: 'run', debugRequested: false, recordRequested: false, usesNativeDebugger: false, recordHistory: true, region: null };
const runConsole = { add: () => {} } as unknown as RunConsole;

function previousRun() {
  useResultStore.getState().settleTabRun('a', { kind: 'success' }, { durationMs: 5 });
  useResultStore.setState({
    lineResults: [{ line: 1, type: 'autoLog', value: '1' }],
    ranCode: { tabId: 'a', code: 'x = 1', input: '', at: 0 },
    isAutoRunning: false,
    isManualRunning: false,
  });
}

afterEach(() => useResultStore.setState(initial, true));

describe('publishRunStart', () => {
  it('keeps the previous answers on screen for a manual run', () => {
    previousRun();
    publishRunStart(tab, plan, runConsole);
    const state = useResultStore.getState();
    expect(state.isManualRunning).toBe(true);
    expect(state.lineResults).toEqual([]);
    expect(state.keptAnswers).toMatchObject({ tabId: 'a', run: 1 });
  });

  it('clears them for a debug run, which shows the paused frame instead', () => {
    previousRun();
    publishRunStart(tab, { ...plan, debugRequested: true }, runConsole);
    expect(useResultStore.getState().keptAnswers).toBeNull();
  });
});
