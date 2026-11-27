import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunMeter } from '@/components/RunMeter/RunMeter';
import type { RecentRunsPopoverProps } from '@/components/Editor/recentRunsPopoverLoader';
import { initI18n } from '@/i18n';
import {
  openRecentRunsPopoverWhenReady,
  setRecentRunsPopoverOpener,
  toggleRecentRunsPopover,
} from '@/runtime/recentRunsPopoverBridge';
import { useDebuggerStore } from '@/stores/debuggerStore';
import { useEditorStore } from '@/stores/editorStore';
import { useLiveRunStore } from '@/stores/liveRunStore';
import { type ExecutionHistoryEntry, useExecutionHistoryStore } from '@/stores/executionHistoryStore';
import { type TabRun, useResultStore } from '@/stores/resultStore';
import { useSettingsStore } from '@/stores/settingsStore';

const mocks = vi.hoisted(() => ({ entitled: true }));

vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => mocks.entitled,
  useEffectiveTier: () => (mocks.entitled ? 'pro' : 'free'),
}));

vi.mock('@/components/Editor/RecentRunsPopoverHost', () => ({
  RecentRunsPopoverHost: ({ entries, onClose, sliceOf, focusId }: RecentRunsPopoverProps) => (
    <div data-testid="recent-runs-popover-host-probe">
      <span data-testid="probe-count">{entries.length}</span>
      <span data-testid="probe-slice-of">{sliceOf ?? 'full'}</span>
      <span data-testid="probe-focus">{focusId ?? 'none'}</span>
      <button type="button" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

const initialEditor = useEditorStore.getState();
const initialHistory = useExecutionHistoryStore.getState();
const initialResult = useResultStore.getState();
const initialDebugger = useDebuggerStore.getState();
const initialSettings = useSettingsStore.getState();

function entry(id: string, runNumber: number): ExecutionHistoryEntry {
  return { id, tabId: 'tab-js', language: 'javascript', status: 'ok', durationMs: 1, timestamp: 100 + runNumber, snapshot: null, runNumber };
}

function seedRuns(runs: TabRun[]) {
  useResultStore.setState({ tabRuns: { 'tab-js': { count: runs.at(-1)?.number ?? 0, runs } } });
}

const ok = (number: number, durationMs: number): TabRun => ({ number, kind: 'success', durationMs });

describe('RunMeter', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    mocks.entitled = true;
    useEditorStore.setState({
      tabs: [{ id: 'tab-js', name: 'main.js', language: 'javascript', content: 'a\nb\nc\nd', isDirty: false, runtimeMode: 'worker' }],
      activeTabId: 'tab-js',
    });
    useExecutionHistoryStore.setState({ entries: [] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    setRecentRunsPopoverOpener(null);
    useEditorStore.setState(initialEditor, true);
    useExecutionHistoryStore.setState(initialHistory, true);
    useResultStore.setState(initialResult, true);
    useDebuggerStore.setState(initialDebugger, true);
    useSettingsStore.setState(initialSettings, true);
  });

  it('reads Not run with a dash before the first run', () => {
    render(<RunMeter tabId="tab-js" />);
    expect(screen.getByTestId('run-meter').dataset.state).toBe('idle');
    expect(screen.getByTestId('run-meter-state').textContent).toContain('Not run');
    // The workspace tag heads the meter like every result header, outside the live state.
    expect(screen.getByTestId('result-header-workspace').textContent).toBe('CODE');
    expect(screen.getByTestId('run-meter-state').contains(screen.getByTestId('result-header-workspace'))).toBe(false);
    expect(screen.getByTestId('run-meter').textContent).toContain('—');
    expect(screen.queryByTestId('run-meter-bars')).toBeNull();
    expect(screen.queryByTestId('dock-execution-time')).toBeNull();
  });

  it('shows the last run, one bar per run with failures in red, and compares with the run before', async () => {
    const onCompare = vi.fn();
    seedRuns([ok(1, 400), { number: 2, kind: 'error', durationMs: 3, line: 3 }, ok(3, 1150)]);
    render(<RunMeter tabId="tab-js" onCompare={onCompare} />);

    expect(screen.getByTestId('run-meter-state').textContent).toBe('Done· run 3');
    expect(screen.getByTestId('dock-execution-time').textContent).toBe('1.15s');
    const bars = screen.getAllByTestId('run-meter-bar');
    expect(bars.map(bar => bar.dataset.kind)).toEqual(['ok', 'error', 'ok']);
    expect(bars[2]!.dataset.latest).toBe('true');
    expect(bars[1]!.getAttribute('aria-label')).toBe('Run 2, error');
    expect(screen.getByTestId('execution-history-toggle').textContent).toBe('3 runs this session');

    await userEvent.setup().click(screen.getByTestId('run-meter-compare'));
    expect(onCompare).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('run-meter-compare').textContent).toBe('Compare with 2');
  });

  it('names the line a failed run raised on and keeps the status pill attributes', () => {
    seedRuns([{ number: 1, kind: 'error', durationMs: 2, line: 3 }]);
    render(<RunMeter tabId="tab-js" />);
    const state = screen.getByTestId('run-meter-state');
    // Both sentences render; the dock's container query shows one of them.
    expect(state.textContent).toBe('Error· run 1· line 3 of 4· line 3Run failed. See the message below.');
    expect(state.dataset.resultKind).toBe('run-status-pill');
    expect(state.dataset.runStatus).toBe('error');
  });

  it('ticks the elapsed time live and fills the live bar toward the previous run', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    seedRuns([ok(1, 1000)]);
    useResultStore.setState({ isManualRunning: true, ranCode: { tabId: 'tab-js', code: '', input: '', at: 10_000 } });
    render(<RunMeter tabId="tab-js" />);
    expect(screen.getByTestId('run-meter-state').textContent).toBe('Running· run 2');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('dock-execution-time').textContent).toBe('500ms');
    const live = screen.getAllByTestId('run-meter-bar').at(-1)!;
    expect(live.dataset.kind).toBe('live');
    expect(live.querySelector('.run-meter-bar-expected')).not.toBeNull();
    expect(screen.getByTestId('execution-history-toggle').textContent).toBe('2 runs this session');
  });

  it('names the line a run in flight is on, out of the polite region', () => {
    seedRuns([ok(1, 1000)]);
    useResultStore.setState({ isManualRunning: true, ranCode: { tabId: 'tab-js', code: '', input: '', at: Date.now() } });
    render(<RunMeter tabId="tab-js" />);
    expect(screen.queryByTestId('run-meter-line')).toBeNull();
    act(() => useLiveRunStore.getState().publish('tab-js', 'r1', { line: 2, lineMs: 0, elapsedMs: 5, loops: [] }));
    const line = screen.getByTestId('run-meter-line');
    expect(line.textContent).toBe('· line 2 of 4· line 2');
    expect(line.getAttribute('aria-hidden')).toBe('true');
    // The line takes the run number's place; the answer column header names the run.
    expect(screen.getByTestId('run-meter-state').textContent).toBe('Running· line 2 of 4· line 2');
    act(() => useLiveRunStore.getState().clear('tab-js', 'r1'));
    expect(screen.queryByTestId('run-meter-line')).toBeNull();
  });

  it('keeps another tab\'s run off this meter and times its own run after a tab switch', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    seedRuns([ok(1, 5)]);
    const session = { tabId: 'other-tab', startedAt: 9_000 } as never;
    useResultStore.setState({ isManualRunning: true, manualRunSession: session, ranCode: null });
    const { unmount } = render(<RunMeter tabId="tab-js" />);
    expect(screen.getByTestId('run-meter-state').textContent).toBe('Done· run 1');
    unmount();
    useResultStore.setState({ manualRunSession: { tabId: 'tab-js', startedAt: 9_000 } as never });
    render(<RunMeter tabId="tab-js" />);
    expect(screen.getByTestId('run-meter-state').textContent).toBe('Running· run 2');
    expect(screen.getByTestId('dock-execution-time').textContent).toBe('1.00s');
  });

  it('shows the paused line as the numeral with its frame, visit and call stack', () => {
    seedRuns([ok(1, 5)]);
    useResultStore.setState({ isManualRunning: true, ranCode: { tabId: 'tab-js', code: '', input: '', at: 9_000 } });
    useDebuggerStore.setState({
      session: { runtime: 'js', tabId: 'tab-js', attachedAt: 1 },
      pausedFrame: {
        tabId: 'tab-js',
        line: 2,
        reason: 'user-breakpoint',
        locals: {},
        callStack: [
          { functionName: 'sort', line: 2, declarationLine: 1 },
          { functionName: 'sort', line: 4, declarationLine: 1 },
          { functionName: '<module>', line: 9 },
        ],
        watchResults: {},
      },
      pauseVisits: { 'tab-js:2': 2 },
    });
    render(<RunMeter tabId="tab-js" />);
    expect(screen.getByTestId('run-meter-state').textContent).toBe('Paused· breakpoint');
    expect(screen.getByTestId('run-meter-paused-line').dataset.line).toBe('2');
    expect(screen.getByTestId('run-meter-paused-line').querySelector('.result-numeral-unit')?.textContent).toBe('line');
    expect(screen.getByTestId('run-meter-paused-line').textContent).toContain('in sort');
    expect(screen.getByTestId('run-meter-visit').textContent).toBe('second visit');
    expect(screen.queryByTestId('dock-execution-time')).toBeNull();
    expect(screen.queryByTestId('run-meter-bars')).toBeNull();
    const stack = screen.getByTestId('debugger-callstack');
    expect(stack.textContent).toContain('Call stack · 3 deep');
    const rows = within(stack).getAllByRole('listitem');
    expect(rows.map(row => row.textContent)).toEqual(['<module>:9', 'sort:4', 'sort:2']);
    expect(rows[2]!.getAttribute('aria-current')).toBe('step');
  });

  it('reads Python module pauses as the top level and folds deep stacks', () => {
    useDebuggerStore.setState({
      session: { runtime: 'python', tabId: 'tab-js', attachedAt: 1 },
      pausedFrame: {
        tabId: 'tab-js',
        line: 3,
        reason: 'step',
        locals: {},
        callStack: [...Array.from({ length: 7 }, (_, index) => ({ functionName: `f${index}`, line: index + 1 })), { functionName: '<module>', line: 9 }],
        watchResults: {},
      },
      pauseVisits: { 'tab-js:3': 5 },
    });
    render(<RunMeter tabId="tab-js" />);
    expect(screen.getByTestId('run-meter-visit').textContent).toBe('visit 5');
    expect(screen.getByTestId('debugger-callstack-more').textContent).toBe('+5 outer calls');
    expect(within(screen.getByTestId('debugger-callstack')).getAllByRole('listitem')).toHaveLength(4);
    act(() =>
      useDebuggerStore.setState({
        pausedFrame: { tabId: 'tab-js', line: 3, reason: 'step', locals: {}, callStack: [{ functionName: '<module>', line: 3 }], watchResults: {} },
      })
    );
    expect(screen.getByTestId('run-meter-paused-line').textContent).toContain('at the top level');
  });

  it('counts down to the limit when the setting is on', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    useSettingsStore.setState({ showTimeoutCountdown: true });
    useResultStore.setState({ isManualRunning: true, runDeadlineAt: 75_000, ranCode: { tabId: 'tab-js', code: '', input: '', at: 10_000 } });
    render(<RunMeter tabId="tab-js" />);
    const state = screen.getByTestId('run-meter-state');
    expect(state.textContent).toContain('1:05 left');
    expect(state.dataset.runStatus).toBe('countdown');
  });

  it('opens the run a bar stands for, and the shortcut toggles the list', async () => {
    seedRuns([ok(1, 4), ok(2, 5)]);
    useExecutionHistoryStore.setState({ entries: [entry('h-1', 1), entry('h-2', 2)] });
    render(<RunMeter tabId="tab-js" />);

    await userEvent.setup().click(screen.getAllByTestId('run-meter-bar')[0]!);
    expect(screen.getByTestId('probe-focus').textContent).toBe('h-1');
    expect(screen.getByTestId('probe-count').textContent).toBe('2');
    await userEvent.setup().click(screen.getByRole('button', { name: 'close' }));
    expect(screen.queryByTestId('recent-runs-popover-host-probe')).toBeNull();

    act(() => {
      expect(toggleRecentRunsPopover()).toBe(true);
    });
    expect(screen.getByTestId('probe-focus').textContent).toBe('none');
    act(() => {
      expect(toggleRecentRunsPopover()).toBe(true);
    });
    expect(screen.queryByTestId('recent-runs-popover-host-probe')).toBeNull();
  });

  it('opens on mount when the shortcut fired while the dock was folded', () => {
    seedRuns([ok(1, 4)]);
    useExecutionHistoryStore.setState({ entries: [entry('h-1', 1)] });
    openRecentRunsPopoverWhenReady();
    render(<RunMeter tabId="tab-js" />);
    expect(screen.getByTestId('recent-runs-popover-host-probe')).toBeTruthy();
  });

  it('gives Free the recent-runs slice', async () => {
    mocks.entitled = false;
    seedRuns([ok(5, 4)]);
    useExecutionHistoryStore.setState({ entries: Array.from({ length: 5 }, (_, index) => entry(`h-${index}`, index + 1)) });
    render(<RunMeter tabId="tab-js" />);
    await userEvent.setup().click(screen.getAllByTestId('run-meter-bar')[0]!);
    expect(screen.getByTestId('probe-count').textContent).toBe('3');
    expect(screen.getByTestId('probe-slice-of').textContent).toBe('5');
  });

  it('keeps the list open on clicks inside it, which renders on the body', async () => {
    seedRuns([ok(1, 4)]);
    useExecutionHistoryStore.setState({ entries: [entry('h-1', 1)] });
    render(<RunMeter tabId="tab-js" />);
    await userEvent.setup().click(screen.getAllByTestId('run-meter-bar')[0]!);
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

  it('draws bars as images without recorded runs to open', () => {
    seedRuns([ok(1, 4)]);
    render(<RunMeter tabId="tab-js" />);
    const bars = within(screen.getByTestId('run-meter-bars')).getAllByRole('img');
    expect(bars).toHaveLength(1);
    expect(toggleRecentRunsPopover()).toBe(false);
  });

  it('renders the Spanish copy', async () => {
    await i18next.changeLanguage('es');
    seedRuns([ok(1, 4), ok(2, 5)]);
    render(<RunMeter tabId="tab-js" onCompare={() => {}} />);
    expect(screen.getByTestId('run-meter-state').textContent).toBe('Terminada· ejecución 2');
    expect(screen.getByTestId('execution-history-toggle').textContent).toBe('2 ejecuciones');
    expect(screen.getByTestId('run-meter-compare').textContent).toBe('Comparar con 1');
  });
});
