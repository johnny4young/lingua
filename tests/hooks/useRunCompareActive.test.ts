import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let entitled = true;
vi.mock('@/hooks/useEntitlement', async importOriginal => ({
  ...(await importOriginal<typeof import('@/hooks/useEntitlement')>()),
  useEntitlement: () => entitled,
}));

import { useLayoutAvailability } from '@/hooks/useLayoutAvailability';
import { useEditorStore } from '@/stores/editorStore';
import { useExecutionHistoryStore } from '@/stores/executionHistoryStore';
import { useResultStore } from '@/stores/resultStore';
import { useSettingsStore } from '@/stores/settingsStore';

const initialHistory = useExecutionHistoryStore.getState();

beforeEach(() => {
  entitled = true;
  act(() => {
    useEditorStore.getState().restoreTabs([{ id: 't1', name: 'q.sql', language: 'python', content: '' }] as never, 't1');
    useResultStore.setState({ snapshotRing: [], scopeSnapshot: null });
    useSettingsStore.setState({ executionHistorySnapshotEnabled: true });
    useExecutionHistoryStore.setState({
      entries: [{ id: 'r', language: 'http', status: 'ok', durationMs: 1, timestamp: 0, snapshot: null }],
    });
  });
});

afterEach(() => {
  useExecutionHistoryStore.setState(initialHistory, true);
  useSettingsStore.setState({ executionHistorySnapshotEnabled: true });
});

describe('Compare tab', () => {
  it('opens on any recorded run while the tier keeps history and code capture is on', () => {
    const { result, rerender } = renderHook(() => useLayoutAvailability());
    expect(result.current.tabs.compare).toBe(true);

    entitled = false;
    rerender();
    expect(result.current.tabs.compare).toBe(false);

    entitled = true;
    rerender();
    expect(result.current.tabs.compare).toBe(true);

    act(() => useSettingsStore.setState({ executionHistorySnapshotEnabled: false }));
    expect(result.current.tabs.compare).toBe(false);

    act(() => {
      useSettingsStore.setState({ executionHistorySnapshotEnabled: true });
      useExecutionHistoryStore.setState({ entries: [] });
    });
    expect(result.current.tabs.compare).toBe(false);
  });
});
