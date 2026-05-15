/**
 * RL-020 Slice 8 — `setTabCompareEnabled` + language-change cleanup.
 *
 * Covers:
 *   - Setter writes / clears the per-tab flag.
 *   - `renameTab` to a different language drops the flag AND
 *     clears the result-store snapshot ring.
 *   - `renameTab` inside the same language preserves the flag and
 *     the snapshot ring.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockTrackEvent } = vi.hoisted(() => ({
  mockTrackEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/telemetry', () => ({
  trackEvent: mockTrackEvent,
}));

import { useEditorStore } from '@/stores/editorStore';
import { useResultStore } from '@/stores/resultStore';

function snapshotForLanguage(language: string): void {
  useResultStore.setState({
    lineResults: [{ line: 1, value: 'snap', type: 'result' }],
    fullOutput: '',
  });
  useResultStore.getState().captureSuccessfulSnapshot(language);
}

describe('RL-020 Slice 8 — editorStore compare flag', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useResultStore.getState().clear();
  });

  it('setTabCompareEnabled writes the flag for an existing tab', () => {
    useEditorStore.getState().addTab({
      id: 'tab-1',
      name: 'a.js',
      language: 'javascript',
      content: '',
    });
    useEditorStore.getState().setTabCompareEnabled('tab-1', true);
    const tab = useEditorStore
      .getState()
      .tabs.find((entry) => entry.id === 'tab-1');
    expect(tab?.compareWithSnapshotEnabled).toBe(true);
  });

  it('setTabCompareEnabled(null) clears the field', () => {
    useEditorStore.getState().addTab({
      id: 'tab-1',
      name: 'a.js',
      language: 'javascript',
      content: '',
    });
    useEditorStore.getState().setTabCompareEnabled('tab-1', true);
    useEditorStore.getState().setTabCompareEnabled('tab-1', null);
    const tab = useEditorStore
      .getState()
      .tabs.find((entry) => entry.id === 'tab-1');
    expect(tab?.compareWithSnapshotEnabled).toBeUndefined();
  });

  it('renameTab to a different language drops the flag and the snapshot', () => {
    useEditorStore.getState().addTab({
      id: 'tab-1',
      name: 'a.js',
      language: 'javascript',
      content: '',
    });
    useEditorStore.setState({ activeTabId: 'tab-1' });
    useEditorStore.getState().setTabCompareEnabled('tab-1', true);
    snapshotForLanguage('javascript');
    expect(useResultStore.getState().lastSuccessfulSnapshot).not.toBeNull();

    useEditorStore.getState().renameTab('tab-1', 'a.py');

    const tab = useEditorStore
      .getState()
      .tabs.find((entry) => entry.id === 'tab-1');
    expect(tab?.language).toBe('python');
    expect(tab?.compareWithSnapshotEnabled).toBeUndefined();
    expect(useResultStore.getState().lastSuccessfulSnapshot).toBeNull();
    expect(useResultStore.getState().snapshotRing).toEqual([]);
  });

  it('renameTab inside the same language preserves the flag and the snapshot', () => {
    useEditorStore.getState().addTab({
      id: 'tab-1',
      name: 'a.js',
      language: 'javascript',
      content: '',
    });
    useEditorStore.setState({ activeTabId: 'tab-1' });
    useEditorStore.getState().setTabCompareEnabled('tab-1', true);
    snapshotForLanguage('javascript');

    useEditorStore.getState().renameTab('tab-1', 'b.js');

    const tab = useEditorStore
      .getState()
      .tabs.find((entry) => entry.id === 'tab-1');
    expect(tab?.compareWithSnapshotEnabled).toBe(true);
    expect(useResultStore.getState().lastSuccessfulSnapshot).not.toBeNull();
  });
});
