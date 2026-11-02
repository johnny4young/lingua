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
import { useSettingsStore } from '@/stores/settingsStore';
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
  RecentRunsPopoverHost: ({ entries, onClose, sliceOf }: RecentRunsPopoverProps) => (
    <div data-testid="recent-runs-popover-host-probe">
      <span>{entries.length}</span>
      <span data-testid="probe-slice-of">{sliceOf ?? 'full'}</span>
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

  it('opens the last three runs on Free with Pro in context', async () => {
    mocks.entitled = false;
    useSettingsStore.setState({ featureFlags: { teachingPaywall: true } });
    try {
      useExecutionHistoryStore.setState({
        entries: Array.from({ length: 5 }, (_, index) => ({ ...makeEntry(), id: `run-${index}`, timestamp: 100 + index })),
      });
      render(<RecentRunsPill />);
      expect(screen.queryByTestId('recent-runs-upsell-pill')).toBeNull();
      await userEvent.setup().click(screen.getByTestId('recent-runs-pill'));
      const probe = screen.getByTestId('recent-runs-popover-host-probe');
      expect(probe.textContent).toContain('3');
      expect(screen.getByTestId('probe-slice-of').textContent).toBe('5');
    } finally {
      useSettingsStore.setState({ featureFlags: {} });
    }
  });

  it('stays open on a click inside the popover, which renders on the body', async () => {
    render(<RecentRunsPill />);
    await userEvent.setup().click(screen.getByTestId('recent-runs-pill'));
    const probe = screen.getByTestId('recent-runs-popover-host-probe');
    expect(probe.closest('.fixed')?.parentElement).toBe(document.body);
    act(() => {
      probe.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(screen.getByTestId('recent-runs-popover-host-probe')).toBeTruthy();
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(screen.queryByTestId('recent-runs-popover-host-probe')).toBeNull();
  });
});

