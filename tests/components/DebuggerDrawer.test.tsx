import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebuggerDrawer } from '@/components/Debugger/DebuggerDrawer';
import { DebuggerChangesSwitch } from '@/components/Debugger/DebuggerDockControls';
import { InlineAnswerLine } from '@/components/Editor/InlineAnswerLine';
import { pausedLineResults } from '@/utils/debuggerLocals';
import { initI18n } from '@/i18n';
import { postDebuggerMessage } from '@/runtime/debuggerWorkerBridge';
import { useDebuggerStore } from '@/stores/debuggerStore';

vi.mock('@/runtime/debuggerWorkerBridge', () => ({
  postDebuggerMessage: vi.fn(() => true),
}));

describe('DebuggerDrawer', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    vi.mocked(postDebuggerMessage).mockClear();
    useDebuggerStore.setState(
      {
        breakpoints: {},
        breakpointOrder: [],
        watches: [],
        session: null,
        pausedFrame: null,
        previousPause: null,
        lastPause: null,
        pauseVisits: {},
        breakpointHits: {},
        showPauseChanges: true,
      },
      false
    );
  });

  it('stays hidden until a matching breakpoint or session exists', () => {
    const { container } = render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    expect(container.firstChild).toBeNull();
  });

  it('inspects without stepping: no step bar, no status header', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    expect(screen.getByTestId('debugger-drawer')).toBeTruthy();
    expect(screen.getByTestId('debugger-empty').textContent).toContain('Press Debug to run until the first enabled breakpoint.');
    for (const id of ['debugger-continue', 'debugger-step-over', 'debugger-step-into', 'debugger-step-out', 'debugger-detach', 'debugger-collapse']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it('explains when every breakpoint is disabled', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);
    useDebuggerStore.getState().setAllBreakpointsEnabled(false);
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    expect(screen.getByTestId('debugger-empty').textContent).toContain('All breakpoints are disabled.');
    expect(screen.getByTestId('debugger-breakpoint-line-2').dataset.enabled).toBe('false');
  });

  it('manages breakpoint batches from the breakpoints column', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);
    useDebuggerStore.getState().toggleBreakpoint('tab-2', 9);
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    fireEvent.click(screen.getByTestId('debugger-toggle-all-breakpoints'));
    expect(Object.values(useDebuggerStore.getState().breakpoints).every(bp => bp.enabled === false)).toBe(true);
    expect(screen.getByTestId('debugger-toggle-all-breakpoints').textContent).toContain('Enable all');
  });

  it('clears all breakpoints after confirmation', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);
    useDebuggerStore.getState().toggleBreakpoint('tab-2', 9);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    fireEvent.click(screen.getByTestId('debugger-clear-all-breakpoints'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(Object.keys(useDebuggerStore.getState().breakpoints)).toHaveLength(0);
    confirmSpy.mockRestore();
  });

  it('uses neutral Spanish copy for breakpoint actions', async () => {
    await i18next.changeLanguage('es');
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    expect(screen.getByTestId('debugger-clear-all-breakpoints').getAttribute('aria-label')).toContain('Limpiar');
    expect(screen.getByTestId('debugger-toggle-all-breakpoints').textContent).toContain('Desactivar');
    expect(screen.queryByText(/Borra/i)).toBeNull();
  });

  it('stays hidden for languages whose debugger adapter is not available', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);
    const { container } = render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="html" />);
    expect(container.firstChild).toBeNull();
  });

  it('marks what changed since the last pause, keeping the order and striking the old value', () => {
    useDebuggerStore.setState({ session: { runtime: 'js', tabId: 'tab-1', attachedAt: 1 } });
    const pause = (line: number, locals: Record<string, string>) =>
      useDebuggerStore.getState().setPausedFrame({ tabId: 'tab-1', line, reason: 'step', locals, callStack: [{ functionName: 'tally', line: 1 }], watchResults: {} });
    pause(3, { count: '1', label: 'a' });
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    const locals = () => screen.getByTestId('debugger-locals');
    expect(locals().querySelectorAll('[data-change]')).toHaveLength(0);
    expect(locals().textContent).toContain('Locals · tally');
    act(() => pause(4, { doubled: '4', label: 'a', count: '2' }));
    const rows = [...locals().querySelectorAll<HTMLElement>('.debugger-local')];
    expect(rows.map(row => row.dataset.local)).toEqual(['count', 'label', 'doubled']);
    expect(rows.map(row => row.dataset.change)).toEqual(['changed', undefined, 'new']);
    expect(within(rows[0]!).getByTestId('answer-was').textContent).toBe('was 1');
    expect(within(rows[2]!).getByText('new')).toBeTruthy();
    expect(screen.getByTestId('debugger-locals-changed').textContent).toBe('2 changed');
    act(() => useDebuggerStore.getState().setShowPauseChanges(false));
    expect(locals().querySelectorAll('[data-change]')).toHaveLength(0);
    expect(screen.queryByTestId('answer-was')).toBeNull();
  });

  it('turns off every struck previous value from the changes switch: Locals, Watch and the held line', async () => {
    const user = userEvent.setup();
    const code = ['let total = 1;', 'total = total + 1;', 'total = total * 2;'].join('\n');
    // The held line as CodeEditor builds it from the store.
    function HeldLine() {
      const pause = useDebuggerStore(state => state.lastPause);
      const previous = useDebuggerStore(state => state.previousPause);
      const compare = useDebuggerStore(state => state.showPauseChanges);
      if (!pause) return null;
      const items = pausedLineResults(pause, previous, code, 'javascript', compare).filter(item => item.held);
      return (
        <div data-testid="held-line">
          <InlineAnswerLine items={items} />
        </div>
      );
    }
    useDebuggerStore.getState().addWatch('total');
    useDebuggerStore.setState({ session: { runtime: 'js', tabId: 'tab-1', attachedAt: 1 } });
    const pause = (line: number, total: string) =>
      useDebuggerStore.getState().setPausedFrame({
        tabId: 'tab-1',
        line,
        reason: 'step',
        locals: { total },
        callStack: [],
        watchResults: { total: { value: total } },
      });
    pause(2, '1');
    render(
      <>
        <DebuggerChangesSwitch tabId="tab-1" />
        <DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />
        <HeldLine />
      </>
    );
    act(() => pause(3, '2'));
    const struck = (testid: string) => screen.getByTestId(testid).querySelectorAll('.answer-delta-before');
    expect(struck('debugger-locals')).toHaveLength(1);
    expect(struck('debugger-watches')).toHaveLength(1);
    expect(struck('held-line')).toHaveLength(1);

    const toggle = screen.getByTestId('debugger-changes-switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(struck('debugger-locals')).toHaveLength(0);
    expect(struck('debugger-watches')).toHaveLength(0);
    expect(struck('held-line')).toHaveLength(0);
    // The current values stay.
    expect(screen.getByTestId('held-line').textContent).toContain('2');
  });

  it('carries the changes switch in the Locals head when the dock is compact', () => {
    useDebuggerStore.setState({ session: { runtime: 'js', tabId: 'tab-1', attachedAt: 1 } });
    useDebuggerStore.getState().setPausedFrame({ tabId: 'tab-1', line: 2, reason: 'step', locals: { a: '1' }, callStack: [], watchResults: {} });
    const { rerender } = render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    expect(screen.queryByTestId('debugger-changes-switch')).toBeNull();
    rerender(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" compactDock />);
    const toggle = within(screen.getByTestId('debugger-locals')).getByTestId('debugger-changes-switch');
    // Only the track shows; the switch keeps its name.
    expect(toggle.getAttribute('aria-label')).toBe('Changes since last pause');
    expect(toggle.querySelector('.debugger-changes-label')).toBeNull();
    // A pause in another tab is not this tab's to compare.
    rerender(<DebuggerDrawer activeTabId="tab-2" activeLanguage="javascript" compactDock />);
    expect(screen.queryByTestId('debugger-changes-switch')).toBeNull();
  });

  it('lists bindings declared further down as subtle rows with the line that assigns them', () => {
    useDebuggerStore.setState({ session: { runtime: 'js', tabId: 'tab-1', attachedAt: 1 } });
    useDebuggerStore.getState().setPausedFrame({
      tabId: 'tab-1',
      line: 4,
      reason: 'user-breakpoint',
      locals: { arr: '[1]', pivot: '1' },
      callStack: [{ functionName: 'quickSort', line: 4 }],
      unassigned: [
        { name: 'left', kind: 'const', line: 4 },
        { name: 'mid', kind: 'const', line: 5 },
        { name: 'right', kind: 'let', line: 6 },
      ],
      watchResults: {},
    });
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    const rows = screen.getAllByTestId('debugger-unassigned');
    expect(rows.map(row => row.textContent)).toEqual(['leftconstnot assigned yet — line 4 has not run', 'midconstline 5rightletline 6']);
    expect([...screen.getByTestId('debugger-locals').querySelectorAll<HTMLElement>('[data-unassigned]')].map(item => item.dataset.unassigned)).toEqual([
      'left',
      'mid',
      'right',
    ]);
    expect(screen.getByTestId('debugger-locals').querySelectorAll('.debugger-local')).toHaveLength(2);
  });

  it('shows unassigned bindings in place of the empty message when no local has a value yet', () => {
    useDebuggerStore.setState({ session: { runtime: 'js', tabId: 'tab-1', attachedAt: 1 } });
    useDebuggerStore.getState().setPausedFrame({
      tabId: 'tab-1',
      line: 1,
      reason: 'step',
      locals: {},
      callStack: [{ functionName: '<module>', line: 1 }],
      unassigned: [{ name: 'total', kind: 'let', line: 1 }],
      watchResults: {},
    });
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    expect(screen.queryByText('No variables are available before this line.')).toBeNull();
    expect(screen.getByTestId('debugger-unassigned').textContent).toBe('totallet' + 'not assigned yet — line 1 has not run');
  });

  it('shows locals and watches with the watch value the last pause held', () => {
    useDebuggerStore.getState().addWatch('value');
    useDebuggerStore.setState({ session: { runtime: 'js', tabId: 'tab-1', attachedAt: 1 } });
    const pause = (line: number, value: string) =>
      useDebuggerStore.getState().setPausedFrame({
        tabId: 'tab-1',
        line,
        reason: 'user-breakpoint',
        locals: { value },
        callStack: [],
        watchResults: { value: { value } },
      });
    pause(4, '41');
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    act(() => pause(5, '42'));
    expect(screen.getByTestId('debugger-locals').querySelector('[data-local="value"]')?.textContent).toContain('42');
    const watch = screen.getByTestId('debugger-watches').querySelector('li')!;
    expect(watch.dataset.change).toBe('changed');
    expect(watch.textContent).toContain('value');
    expect(within(watch).getByTestId('answer-was').textContent).toBe('was 41');
  });

  it('keeps Python breakpoints pause-only and discloses native watch evaluation', async () => {
    const user = userEvent.setup();
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);
    useDebuggerStore.getState().addWatch('value + 1');
    useDebuggerStore.setState({
      session: { runtime: 'python', tabId: 'tab-1', attachedAt: 1 },
      pausedFrame: {
        tabId: 'tab-1',
        line: 2,
        reason: 'user-breakpoint',
        locals: { value: '41' },
        callStack: [{ functionName: '<module>', line: 2 }],
        watchResults: { 'value + 1': { value: '42' } },
      },
    });
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="python" />);
    expect(screen.getByTestId('debugger-locals').querySelector('h4')?.textContent).toBe('Locals');
    await user.click(screen.getByTestId('debugger-breakpoint-edit-2'));
    expect(screen.queryByLabelText('Breakpoint behavior at line 2')).toBeNull();
    expect(screen.getByText(/standard pause breakpoints/i)).toBeTruthy();
    expect(screen.getByText(/may have side effects/i)).toBeTruthy();
  });

  it('lists breakpoints as rows with their hits this session, conditions and logpoints', async () => {
    const user = userEvent.setup();
    const store = useDebuggerStore.getState();
    store.toggleBreakpoint('tab-1', 4);
    store.toggleBreakpoint('tab-1', 6);
    store.setBreakpointCondition('tab-1', 6, 'pivot > 5');
    store.toggleBreakpoint('tab-1', 23);
    store.setBreakpointLogMessage('tab-1', 23, '{nums}');
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    expect(screen.queryByTestId('debugger-breakpoint-count-4')).toBeNull();
    act(() => {
      store.attachSession({ runtime: 'js', tabId: 'tab-1', attachedAt: 1 });
      store.setPausedFrame({ tabId: 'tab-1', line: 4, reason: 'user-breakpoint', locals: {}, callStack: [], watchResults: {} });
      store.setPausedFrame(null);
      store.setPausedFrame({ tabId: 'tab-1', line: 4, reason: 'user-breakpoint', locals: {}, callStack: [], watchResults: {} });
    });
    expect(screen.getByTestId('debugger-breakpoint-count-4').textContent).toBe('hit 2');
    expect(screen.getByTestId('debugger-breakpoint-count-6').textContent).toBe('not reached');
    expect(screen.queryByTestId('debugger-breakpoint-count-23')).toBeNull();
    expect(screen.getByTestId('debugger-breakpoint-edit-6').textContent).toBe('if pivot > 5');
    expect(screen.getByTestId('debugger-breakpoint-edit-23').textContent).toBe('log {nums}');
    // Each row carries the gutter's mark; a logpoint is a ringed minus.
    expect(screen.getByTestId('debugger-breakpoint-line-23').querySelector('svg')?.getAttribute('class')).toContain('lucide-circle-minus');
    expect(screen.getByTestId('debugger-breakpoint-line-6').querySelector('svg')?.getAttribute('class')).toContain('lucide-diamond');
    await user.click(screen.getByLabelText('Enable breakpoint at line 4'));
    expect(useDebuggerStore.getState().breakpoints['tab-1:4']?.enabled).toBe(false);
    await user.click(screen.getByTestId('debugger-breakpoint-edit-4'));
    await user.click(screen.getByLabelText('Remove breakpoint at line 4'));
    expect(useDebuggerStore.getState().breakpoints['tab-1:4']).toBeUndefined();
  });

  it('configures conditional breakpoints, logpoints, and watches from the panel', async () => {
    const user = userEvent.setup();
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    const edit = screen.getByTestId('debugger-breakpoint-edit-2');
    expect(edit.getAttribute('aria-expanded')).toBe('false');
    await user.click(edit);
    expect(edit.getAttribute('aria-expanded')).toBe('true');

    await user.selectOptions(screen.getByLabelText('Breakpoint behavior at line 2'), 'conditional');
    await user.type(screen.getByLabelText('Condition for breakpoint at line 2'), 'value > 3');
    expect(useDebuggerStore.getState().breakpoints['tab-1:2']).toMatchObject({ mode: 'conditional', condition: 'value > 3' });

    await user.selectOptions(screen.getByLabelText('Breakpoint behavior at line 2'), 'logpoint');
    fireEvent.change(screen.getByLabelText('Logpoint message at line 2'), { target: { value: 'value is {value}' } });
    expect(useDebuggerStore.getState().breakpoints['tab-1:2']).toMatchObject({ mode: 'logpoint', logMessage: 'value is {value}' });

    expect(screen.queryByTestId('debugger-watch-add')).toBeNull();
    await user.type(screen.getByTestId('debugger-watch-input'), 'value * 2');
    await user.click(screen.getByTestId('debugger-watch-add'));
    expect(useDebuggerStore.getState().watches[0]?.expression).toBe('value * 2');
    await user.click(screen.getByTestId('debugger-watch-focus'));
    expect(document.activeElement).toBe(screen.getByTestId('debugger-watch-input'));
  });

  it('keeps a breakpoint editor to its own tab', async () => {
    const user = userEvent.setup();
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 5);
    useDebuggerStore.getState().toggleBreakpoint('tab-2', 5);
    const { rerender } = render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    await user.click(screen.getByTestId('debugger-breakpoint-edit-5'));
    expect(screen.getByTestId('debugger-breakpoint-line-5').dataset.open).toBe('true');
    rerender(<DebuggerDrawer activeTabId="tab-2" activeLanguage="javascript" />);
    expect(screen.getByTestId('debugger-breakpoint-line-5').dataset.open).toBeUndefined();
  });

  it('compares locals and watches only with a pause in the same function', () => {
    useDebuggerStore.getState().addWatch('count');
    useDebuggerStore.setState({ session: { runtime: 'js', tabId: 'tab-1', attachedAt: 1 } });
    const pause = (fn: string, count: string) =>
      useDebuggerStore.getState().setPausedFrame({
        tabId: 'tab-1',
        line: fn === 'f' ? 2 : 6,
        reason: 'user-breakpoint',
        locals: { count },
        callStack: [{ functionName: fn, line: 1 }],
        watchResults: { count: { value: count } },
      });
    pause('f', '1');
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    act(() => pause('g', '5'));
    expect(screen.queryByTestId('answer-was')).toBeNull();
    expect(screen.getByTestId('debugger-locals').querySelectorAll('[data-change]')).toHaveLength(0);
  });

  it('surfaces conditional evaluation errors as a fail-safe pause', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);
    useDebuggerStore.setState({
      session: { runtime: 'js', tabId: 'tab-1', attachedAt: 1 },
      pausedFrame: {
        tabId: 'tab-1',
        line: 2,
        reason: 'user-breakpoint',
        locals: {},
        callStack: [],
        watchResults: {},
        conditionError: 'Unknown identifier: missing',
      },
    });
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    expect(screen.getByTestId('debugger-condition-error').textContent).toContain('paused instead of silently skipping');
  });

  it('carries the call stack for docks too narrow for the run meter column', () => {
    useDebuggerStore.setState({
      session: { runtime: 'js', tabId: 'tab-1', attachedAt: 1 },
      pausedFrame: { tabId: 'tab-1', line: 2, reason: 'step', locals: {}, callStack: [{ functionName: 'llamar', line: 1 }], watchResults: {} },
    });
    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    expect(screen.getByTestId('debugger-callstack-narrow').textContent).toContain('llamar');
  });
});
