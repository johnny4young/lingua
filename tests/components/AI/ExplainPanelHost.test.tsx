import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExplainPanelHost } from '../../../src/renderer/components/AI/ExplainPanelHost';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useExplainPanelStore } from '../../../src/renderer/stores/explainPanelStore';
import { useResultStore } from '../../../src/renderer/stores/resultStore';

vi.mock('../../../src/renderer/components/AI/ExplainErrorPanel', () => ({ ExplainErrorPanel: () => <aside data-testid="panel" /> }));

const target = { tabId: 't1', errorMessage: 'TypeError: x', line: 2, column: 1 };

beforeEach(() => {
  useEditorStore.getState().restoreTabs([{ id: 't1', name: 'a.js', language: 'javascript', content: 'x' }] as never, 't1');
  useResultStore.setState({ error: { message: 'x', line: 2 }, isAutoRunning: false, isManualRunning: false, autoRunGateReason: null });
  useExplainPanelStore.setState({ target: null, pinned: false, threads: {} });
});

describe('explain panel host', () => {
  it('closes an unpinned panel when the next run changes the error', () => {
    render(<ExplainPanelHost />);
    act(() => useExplainPanelStore.getState().open(target));
    act(() => useResultStore.setState({ error: { message: 'x', line: 2 } }));
    expect(useExplainPanelStore.getState().target).toEqual(target);
    act(() => useResultStore.setState({ error: null }));
    expect(useExplainPanelStore.getState().target).toBeNull();
  });

  it('waits for a run to settle, and ignores half-typed code, before closing', () => {
    render(<ExplainPanelHost />);
    act(() => useExplainPanelStore.getState().open(target));
    act(() => useResultStore.setState({ isAutoRunning: true, error: null }));
    expect(useExplainPanelStore.getState().target).toEqual(target);
    act(() => useResultStore.setState({ isAutoRunning: false, autoRunGateReason: 'incomplete' }));
    expect(useExplainPanelStore.getState().target).toEqual(target);
    act(() => useResultStore.setState({ autoRunGateReason: null, error: { message: 'other', line: 3 } }));
    expect(useExplainPanelStore.getState().target).toBeNull();
  });

  it('keeps a pinned panel open through runs', () => {
    render(<ExplainPanelHost />);
    act(() => {
      useExplainPanelStore.getState().open(target);
      useExplainPanelStore.getState().setPinned(true);
    });
    act(() => useResultStore.setState({ error: null }));
    expect(useExplainPanelStore.getState().target).toEqual(target);
  });

  it('drops the thread and the panel of a closed tab', () => {
    render(<ExplainPanelHost />);
    act(() => {
      useExplainPanelStore.getState().open(target);
      useExplainPanelStore.getState().saveThread('t1', 'TypeError: x', 'https://a', [{ role: 'user', content: 'q' }]);
    });
    act(() => useEditorStore.getState().restoreTabs([], null));
    expect(useExplainPanelStore.getState().threads).toEqual({});
    expect(useExplainPanelStore.getState().target).toBeNull();
  });

  it('forgets a thread once the tab hits a different error', () => {
    useExplainPanelStore.getState().saveThread('t1', 'TypeError: x', 'https://a', [{ role: 'user', content: 'q' }]);
    expect(useExplainPanelStore.getState().threadFor('t1', 'TypeError: x', 'https://a')).toHaveLength(1);
    expect(useExplainPanelStore.getState().threadFor('t1', 'RangeError: y', 'https://a')).toEqual([]);
    // A thread approved for one endpoint is never re-sent to another.
    expect(useExplainPanelStore.getState().threadFor('t1', 'TypeError: x', 'https://b')).toEqual([]);
  });
});
