import { afterEach, describe, expect, it } from 'vitest';
import { TAB_ANSWERS_CAP, useResultStore } from '@/stores/resultStore';

const initial = useResultStore.getState();

afterEach(() => useResultStore.setState(initial, true));

function run(tabId: string, value: string, code = 'x') {
  useResultStore.getState().settleTabRun(tabId, { kind: 'success' }, { durationMs: 1 });
  useResultStore.getState().recordTabAnswers(tabId, [{ line: 1, value, type: 'log' }], code);
}

describe('tab answers', () => {
  it('keeps the latest and previous run of each tab with their sources', () => {
    run('a', '1', 'print(1)');
    expect(useResultStore.getState().tabAnswers.a).toEqual({
      latest: { number: 1, results: [{ line: 1, value: '1', type: 'log' }], sources: { 1: 'print(1)' } },
    });
    run('a', '2', 'print(2)');
    run('b', '9');
    useResultStore.getState().clear();
    const { a } = useResultStore.getState().tabAnswers;
    expect(a?.latest).toMatchObject({ number: 2, sources: { 1: 'print(2)' } });
    expect(a?.previous).toMatchObject({ number: 1, results: [{ value: '1' }] });
  });

  it('replaces a republished run instead of comparing it with itself', () => {
    run('a', '1');
    run('a', '2');
    useResultStore.getState().recordTabAnswers('a', [{ line: 1, value: '3', type: 'log' }], 'x');
    expect(useResultStore.getState().tabAnswers.a?.previous?.number).toBe(1);
    expect(useResultStore.getState().tabAnswers.a?.latest.results[0]?.value).toBe('3');
  });

  it('ignores a tab with no settled run and caps the tabs it keeps', () => {
    useResultStore.getState().recordTabAnswers('none', [], '');
    expect(useResultStore.getState().tabAnswers.none).toBeUndefined();
    for (let index = 0; index < TAB_ANSWERS_CAP + 2; index += 1) run(`t${index}`, '1');
    const kept = Object.keys(useResultStore.getState().tabAnswers);
    expect(kept).toHaveLength(TAB_ANSWERS_CAP);
    expect(kept).not.toContain('t0');
    expect(kept).toContain(`t${TAB_ANSWERS_CAP + 1}`);
  });
});
