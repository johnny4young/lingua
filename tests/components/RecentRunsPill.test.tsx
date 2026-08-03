import { Profiler } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecentRunsPill } from '@/components/Editor/RecentRunsPill';
import type { RecentRunsPopoverProps } from '@/components/Editor/recentRunsPopoverLoader';
import { initI18n } from '@/i18n';
import {
  setRecentRunsPopoverOpener,
  toggleRecentRunsPopover,
} from '@/runtime/recentRunsPopoverBridge';
import { useEditorStore } from '@/stores/editorStore';
import {
  type ExecutionHistoryEntry,
  useExecutionHistoryStore,
} from '@/stores/executionHistoryStore';

const mocks = vi.hoisted(() => ({
  entitled: true,
}));

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => mocks.entitled,
}));

vi.mock('@/components/Editor/RecentRunsPopoverHost', () => ({
  RecentRunsPopoverHost: ({ entries, onClose }: RecentRunsPopoverProps) => (
    <div data-testid="recent-runs-popover-host-probe">
      <span>{entries.length}</span>
      <button type="button" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

const initialEditorState = useEditorStore.getState();
const initialHistoryState = useExecutionHistoryStore.getState();

function makeEntry(): ExecutionHistoryEntry {
  return {
    id: 'run-1',
    tabId: 'tab-js',
    language: 'javascript',
    status: 'ok',
    durationMs: 1,
    timestamp: 100,
    snapshot: null,
  };
}

describe('RecentRunsPill', () => {
  beforeEach(() => {
    initI18n('en');
    mocks.entitled = true;
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-js',
          name: 'main.js',
          language: 'javascript',
          content: 'const answer = 42;',
          isDirty: false,
          runtimeMode: 'worker',
        },
      ],
      activeTabId: 'tab-js',
    });
    useExecutionHistoryStore.setState({ entries: [makeEntry()] });
  });

  afterEach(() => {
    cleanup();
    setRecentRunsPopoverOpener(null);
    useEditorStore.setState(initialEditorState, true);
    useExecutionHistoryStore.setState(initialHistoryState, true);
  });

  it('activates the popover by click and keyboard without reacting to keystrokes', async () => {
    const user = userEvent.setup();
    let commits = 0;
    render(
      <Profiler
        id="recent-runs-pill"
        onRender={() => {
          commits += 1;
        }}
      >
        <RecentRunsPill />
      </Profiler>
    );

    expect(screen.queryByTestId('recent-runs-popover-host-probe')).toBeNull();
    const commitsAfterMount = commits;
    act(() => {
      useEditorStore.getState().updateContent('tab-js', 'const answer = 43;');
      useEditorStore.getState().updateContent('tab-js', 'const answer = 44;');
    });
    expect(commits).toBe(commitsAfterMount);

    await user.click(screen.getByTestId('recent-runs-pill'));
    expect(screen.getByTestId('recent-runs-popover-host-probe').textContent).toContain('1');
    await user.click(screen.getByRole('button', { name: 'close' }));
    expect(screen.queryByTestId('recent-runs-popover-host-probe')).toBeNull();

    act(() => {
      expect(toggleRecentRunsPopover()).toBe(true);
    });
    expect(screen.getByTestId('recent-runs-popover-host-probe')).toBeTruthy();
    act(() => {
      expect(toggleRecentRunsPopover()).toBe(true);
    });
    expect(screen.queryByTestId('recent-runs-popover-host-probe')).toBeNull();
  });

  it('keeps the Free upsell eager without mounting the Pro popover host', () => {
    mocks.entitled = false;
    render(<RecentRunsPill />);

    expect(screen.getByTestId('recent-runs-upsell-pill')).toBeTruthy();
    expect(screen.queryByTestId('recent-runs-popover-host-probe')).toBeNull();
  });
});
