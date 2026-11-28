import { afterEach, describe, expect, it } from 'vitest';
import { dropRunStateWithItsTab } from '@/stores/dropRunStateWithItsTab';
import { useEditorStore } from '@/stores/editorStore';
import { useResultStore } from '@/stores/resultStore';
import type { FileTab } from '@/types/editor';

const tab = (id: string): FileTab => ({ id, name: `${id}.js`, language: 'javascript', content: '', isDirty: false });
const log = { count: 2, runs: [] };
const answers = { latest: { number: 2, results: [], sources: {} } };

describe('dropRunStateWithItsTab', () => {
  afterEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useResultStore.setState({ tabRuns: {}, tabAnswers: {} });
  });

  it('drops a closed tab’s run log and answers and keeps the open tabs’', () => {
    dropRunStateWithItsTab();
    useEditorStore.setState({ tabs: [tab('a'), tab('b')], activeTabId: 'a' });
    useResultStore.setState({ tabRuns: { a: log, b: log }, tabAnswers: { a: answers, b: answers } });

    useEditorStore.setState({ tabs: [tab('a')] });

    expect(Object.keys(useResultStore.getState().tabRuns)).toEqual(['a']);
    expect(Object.keys(useResultStore.getState().tabAnswers)).toEqual(['a']);
  });

  it('keeps counting the runs of a tab that was never open', () => {
    dropRunStateWithItsTab();
    useEditorStore.setState({ tabs: [tab('a')], activeTabId: 'a' });
    useResultStore.setState({ tabRuns: { a: log, synthetic: log } });

    useEditorStore.setState({ tabs: [tab('a'), tab('b')] });

    expect(Object.keys(useResultStore.getState().tabRuns).sort()).toEqual(['a', 'synthetic']);
  });
});
