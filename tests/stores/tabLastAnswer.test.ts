import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '@/stores/editorStore';
import { recordTabLastAnswer } from '@/stores/tabLastAnswer';
import { selectTabLastAnswer } from '@/stores/lastAnswerSelectors';
import type { FileTab } from '@/types/editor';
import type { LastAnswer } from '@/utils/lastAnswer';

const tab = (id: string): FileTab => ({ id, name: `${id}.js`, language: 'javascript', content: '1', isDirty: false });
const answer = (durationMs: number): LastAnswer => ({ kind: 'code', status: 'ok', numeral: '1', durationMs, ranAt: 1_700_000_000_000 });

describe('recordTabLastAnswer', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [tab('a'), tab('b')], activeTabId: 'a' });
  });

  it('writes the answer to its tab only and keeps the other tabs by reference', async () => {
    const before = useEditorStore.getState().tabs;
    await recordTabLastAnswer('a', () => answer(30));
    const after = useEditorStore.getState().tabs;
    expect(selectTabLastAnswer('a')(useEditorStore.getState())).toEqual(answer(30));
    expect(after[1]).toBe(before[1]);
  });

  it('replaces the previous answer and records the duration change', async () => {
    await recordTabLastAnswer('a', () => answer(30));
    await recordTabLastAnswer('a', () => ({ ...answer(18), numeral: '2' }));
    expect(selectTabLastAnswer('a')(useEditorStore.getState())).toEqual({ ...answer(18), numeral: '2', deltaMs: -12 });
  });

  it('skips a repeat answer within a minute so the tabs and session stay untouched', async () => {
    await recordTabLastAnswer('a', () => answer(30));
    const before = useEditorStore.getState().tabs;
    await recordTabLastAnswer('a', () => ({ ...answer(31), ranAt: answer(0).ranAt + 30_000 }));
    expect(useEditorStore.getState().tabs).toBe(before);
    await recordTabLastAnswer('a', () => ({ ...answer(31), ranAt: answer(0).ranAt + 60_000 }));
    expect(selectTabLastAnswer('a')(useEditorStore.getState())).toMatchObject({ durationMs: 31, deltaMs: 1 });
  });

  it('ignores a tab that closed before the run finished', async () => {
    const before = useEditorStore.getState().tabs;
    await recordTabLastAnswer('gone', () => answer(10));
    expect(useEditorStore.getState().tabs).toBe(before);
  });
});
