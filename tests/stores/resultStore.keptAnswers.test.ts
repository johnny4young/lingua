import { afterEach, describe, expect, it } from 'vitest';
import { holdVisibleResults } from '@/stores/holdVisibleResults';
import { useResultStore } from '@/stores/resultStore';

const initial = useResultStore.getState();

function publishRunOf(tabId: string) {
  useResultStore.getState().settleTabRun(tabId, { kind: 'success' }, { durationMs: 5 });
  useResultStore.setState({
    lineResults: [{ line: 2, type: 'autoLog', value: '42' }],
    lineTimings: [{ line: 3, durationMs: 4 }],
    fullOutput: '42',
    ranCode: { tabId, code: 'x\n42\ny', input: '', at: 0 },
  });
}

/** A run starts the way auto-runs and manual runs do: hold first, then mark itself running. */
function startRun(tabId: string) {
  holdVisibleResults(tabId);
  useResultStore.getState().setIsAutoRunning(true);
}

afterEach(() => useResultStore.setState(initial, true));

describe('kept answers', () => {
  it('keeps the run whose answers stay on screen and clears the rest for the run that starts', () => {
    publishRunOf('a');
    startRun('a');
    const state = useResultStore.getState();
    expect(state.keptAnswers).toEqual({ tabId: 'a', run: 1 });
    expect(state.lineResults).toEqual([]);
    expect(state.lineTimings).toEqual([]);
    expect(state.fullOutput).toBe('');
  });

  it('keeps what a run still in flight kept when another run starts before it answers', () => {
    publishRunOf('a');
    startRun('a');
    startRun('a');
    expect(useResultStore.getState().keptAnswers).toEqual({ tabId: 'a', run: 1 });
  });

  it('never brings back the answers of a run that settled without answering', () => {
    publishRunOf('a');
    startRun('a');
    useResultStore.getState().setIsAutoRunning(false);
    startRun('a');
    expect(useResultStore.getState().keptAnswers).toBeNull();
  });

  it('names the run whose answers are on screen, such as an earlier one restored after a failed run', () => {
    publishRunOf('a');
    useResultStore.getState().recordTabAnswers('a', useResultStore.getState().lineResults, 'x\n42\ny');
    useResultStore.getState().settleTabRun('a', { kind: 'error' }, { durationMs: 5 });
    useResultStore.getState().recordTabAnswers('a', [], 'x');
    startRun('a');
    expect(useResultStore.getState().keptAnswers).toEqual({ tabId: 'a', run: 1 });
  });

  it('never keeps another tab\'s answers, and drops them on a tab switch or an empty buffer', () => {
    publishRunOf('a');
    startRun('b');
    expect(useResultStore.getState().keptAnswers).toBeNull();
    for (const end of [() => useResultStore.getState().clear(), () => useResultStore.getState().clearVisibleResults()]) {
      publishRunOf('a');
      startRun('a');
      end();
      expect(useResultStore.getState().keptAnswers).toBeNull();
    }
  });
});
