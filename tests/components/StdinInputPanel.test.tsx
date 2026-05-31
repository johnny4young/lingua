/**
 * RL-020 Slice 6 — StdinInputPanel render contract.
 *
 * Covers:
 *   - Renders the textarea for JS / TS / Python tabs.
 *   - Renders the unsupportedLanguage hint for non-supported tabs.
 *   - Renders the empty state when no active tab.
 *   - "Used N of M lines" pill appears when stdinConsumed is set on
 *     the result store.
 *   - Typing into the textarea calls `setTabStdinBuffer`.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StdinInputPanel } from '../../src/renderer/components/Editor/StdinInputPanel';
import { useResultStore } from '../../src/renderer/stores/resultStore';

interface MockTab {
  id: string;
  name: string;
  language: string;
  content: string;
  isDirty: boolean;
  stdinBuffer?: string;
}

const editorState: {
  tabs: MockTab[];
  activeTabId: string | null;
  setTabStdinBuffer: ReturnType<typeof vi.fn>;
} = {
  tabs: [],
  activeTabId: null,
  setTabStdinBuffer: vi.fn(),
};

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: (selector?: (state: unknown) => unknown) => {
    return selector ? selector(editorState) : editorState;
  },
  getActiveTab: (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
    s.tabs.find((t) => t.id === s.activeTabId) ?? null,
  getActiveTabIndex: (s: { tabs: Array<{ id: string }>; activeTabId: string | null }) =>
    s.activeTabId == null ? -1 : s.tabs.findIndex((t) => t.id === s.activeTabId),
}));

describe('StdinInputPanel (RL-020 Slice 6)', () => {
  const initialResultState = useResultStore.getState();

  beforeEach(() => {
    useResultStore.setState(initialResultState, true);
    editorState.tabs = [];
    editorState.activeTabId = null;
    editorState.setTabStdinBuffer = vi.fn();
  });

  it('renders the empty state when no active tab is selected', () => {
    render(<StdinInputPanel />);
    expect(screen.getByTestId('stdin-panel-empty')).toBeTruthy();
  });

  it('renders the unsupported-language hint for a Rust tab', () => {
    editorState.tabs = [
      { id: 't1', name: 'main.rs', language: 'rust', content: '', isDirty: false },
    ];
    editorState.activeTabId = 't1';
    render(<StdinInputPanel />);
    expect(screen.getByTestId('stdin-panel-unsupported')).toBeTruthy();
  });

  it('renders per-line inputs for a JS tab and writes via the action', () => {
    // RL-093 — the v2 panel replaced the single textarea with one input
    // per ordered-queue row. The test now writes into the first row and
    // expects the action to be called with the same `'5'` buffer.
    editorState.tabs = [
      { id: 't1', name: 'main.js', language: 'javascript', content: '', isDirty: false },
    ];
    editorState.activeTabId = 't1';
    render(<StdinInputPanel />);
    const firstRow = screen.getByTestId('stdin-row-0');
    const input = firstRow.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: '5' } });
    expect(editorState.setTabStdinBuffer).toHaveBeenCalledWith('t1', '5');
  });

  it('surfaces the consumed pill when the result store carries a stdinConsumed summary', () => {
    editorState.tabs = [
      {
        id: 't1',
        name: 'main.py',
        language: 'python',
        content: '',
        isDirty: false,
        stdinBuffer: '2\n3\n5',
      },
    ];
    editorState.activeTabId = 't1';
    useResultStore.setState({
      lineResults: [],
      fullOutput: '',
      stdinConsumed: { count: 2, total: 3 },
      error: null,
      diagnostics: [],
      executionTime: 8,
      isAutoRunning: false,
      isManualRunning: false,
      executionSource: 'auto',
      autoRunGateReason: null,
      lastSuccessfulSnapshot: null,
    });
    render(<StdinInputPanel />);
    const pill = screen.getByTestId('stdin-panel-consumed');
    expect(pill.textContent).toMatch(/2.*3/);
  });
});
