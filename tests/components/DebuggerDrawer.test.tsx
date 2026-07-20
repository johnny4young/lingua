import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebuggerDrawer } from '@/components/Debugger/DebuggerDrawer';
import { initI18n } from '@/i18n';
import { postDebuggerMessage } from '@/runtime/debuggerWorkerBridge';
import { useDebuggerStore } from '@/stores/debuggerStore';
import { useSettingsStore } from '@/stores/settingsStore';

vi.mock('@/runtime/debuggerWorkerBridge', () => ({
  postDebuggerMessage: vi.fn(() => true),
}));

describe('DebuggerDrawer', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    vi.mocked(postDebuggerMessage).mockClear();
    useSettingsStore.setState({ debuggerEnabled: true }, false);
    useDebuggerStore.setState(
      {
        breakpoints: {},
        breakpointOrder: [],
        watches: [],
        session: null,
        pausedFrame: null,
        drawerCollapsed: false,
      },
      false
    );
  });

  it('stays hidden until a matching breakpoint or session exists', () => {
    const { container } = render(
      <DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the idle drawer when the active tab has a breakpoint', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);

    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);

    expect(screen.getByTestId('debugger-drawer')).toBeTruthy();
    expect(screen.getByTestId('debugger-breakpoint-summary').textContent).toContain('1/1 active');
    expect(screen.getByTestId('debugger-empty').textContent).toContain(
      'Press Debug to run until the first enabled breakpoint.'
    );
    expect(screen.getByTestId('debugger-continue').hasAttribute('disabled')).toBe(true);
  });

  it('explains when every breakpoint is disabled', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);
    useDebuggerStore.getState().setAllBreakpointsEnabled(false);

    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);

    expect(screen.getByTestId('debugger-empty').textContent).toContain(
      'All breakpoints are disabled.'
    );
    expect(screen.getByTestId('debugger-breakpoint-summary').textContent).toContain('0/1 active');
  });

  it('manages breakpoint batches from the debugger panel', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);
    useDebuggerStore.getState().toggleBreakpoint('tab-2', 9);

    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    fireEvent.click(screen.getByTestId('debugger-toggle-all-breakpoints'));

    expect(
      Object.values(useDebuggerStore.getState().breakpoints).every((bp) => bp.enabled === false)
    ).toBe(true);
    expect(screen.getByTestId('debugger-toggle-all-breakpoints').textContent).toContain(
      'Enable all'
    );
  });

  it('surfaces contextual tooltips for debugger status and controls', async () => {
    const user = userEvent.setup();
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);
    useDebuggerStore.setState({
      session: { runtime: 'js', tabId: 'tab-1', attachedAt: 1 },
      pausedFrame: {
        tabId: 'tab-1',
        line: 2,
        reason: 'user-breakpoint',
        locals: {},
        callStack: [{ functionName: 'main', line: 1 }],
        watchResults: {},
      },
    });

    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);

    await user.hover(screen.getByTestId('debugger-breakpoint-summary'));
    expect((await screen.findByRole('tooltip')).textContent).toContain(
      '1 of 1 breakpoints are active'
    );

    await user.unhover(screen.getByTestId('debugger-breakpoint-summary'));
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
    await user.hover(screen.getByTestId('debugger-continue'));
    expect((await screen.findByRole('tooltip')).textContent).toContain(
      'Resume execution until the next breakpoint'
    );

    await user.unhover(screen.getByTestId('debugger-continue'));
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
    await user.hover(screen.getByTestId('debugger-step-into'));
    expect((await screen.findByRole('tooltip')).textContent).toContain(
      'Enter a local function call'
    );
  });

  it('clears all breakpoints from the debugger panel after confirmation', () => {
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

    expect(screen.getByTestId('debugger-clear-all-breakpoints').textContent).toContain('Limpiar');
    expect(screen.queryByText(/Borra/i)).toBeNull();
  });

  it('stays hidden for languages whose debugger adapter is not available', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);

    const { container } = render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="python" />);

    expect(container.firstChild).toBeNull();
  });

  it('renders paused locals and dispatches step controls', () => {
    useDebuggerStore.setState({
      session: { runtime: 'js', tabId: 'tab-1', attachedAt: 1 },
      pausedFrame: {
        tabId: 'tab-1',
        line: 4,
        reason: 'user-breakpoint',
        locals: { value: '42' },
        callStack: [{ functionName: 'main', line: 1 }],
        watchResults: { value: { pending: true } },
      },
    });

    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);

    expect(screen.getByTestId('debugger-locals').textContent).toContain('value: 42');
    expect(screen.getByTestId('debugger-callstack').textContent).toContain('main');
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByTestId('debugger-watches').textContent).toContain(
      'Pending evaluation'
    );

    fireEvent.click(screen.getByTestId('debugger-step-over'));

    expect(postDebuggerMessage).toHaveBeenCalledWith({ type: 'step', mode: 'over' });
    expect(useDebuggerStore.getState().pausedFrame).toBeNull();
  });

  it('only enables step out while paused inside a function frame', () => {
    useDebuggerStore.setState({
      session: { runtime: 'js', tabId: 'tab-1', attachedAt: 1 },
      pausedFrame: {
        tabId: 'tab-1',
        line: 4,
        reason: 'user-breakpoint',
        locals: {},
        callStack: [],
        watchResults: {},
      },
    });

    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);

    expect(screen.getByTestId('debugger-step-out').hasAttribute('disabled')).toBe(true);
  });

  it('runs to the end by clearing breakpoints before resuming from detach', () => {
    useDebuggerStore.setState({
      session: { runtime: 'js', tabId: 'tab-1', attachedAt: 1 },
      pausedFrame: {
        tabId: 'tab-1',
        line: 4,
        reason: 'user-breakpoint',
        locals: {},
        callStack: [],
        watchResults: {},
      },
    });

    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);
    fireEvent.click(screen.getByTestId('debugger-detach'));

    expect(postDebuggerMessage).toHaveBeenNthCalledWith(1, {
      type: 'set-breakpoints',
      breakpoints: [],
    });
    expect(postDebuggerMessage).toHaveBeenNthCalledWith(2, { type: 'resume' });
    expect(useDebuggerStore.getState().session).toBeNull();
    expect(useDebuggerStore.getState().pausedFrame).toBeNull();
  });

  it('chevron toggles drawerCollapsed and hides the body (implementation note)', () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 2);

    render(<DebuggerDrawer activeTabId="tab-1" activeLanguage="javascript" />);

    const collapse = screen.getByTestId('debugger-collapse');
    expect(collapse.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByTestId('debugger-empty')).not.toBeNull();

    fireEvent.click(collapse);

    expect(useDebuggerStore.getState().drawerCollapsed).toBe(true);
    expect(screen.queryByTestId('debugger-empty')).toBeNull();
    expect(screen.getByTestId('debugger-collapse').getAttribute('aria-expanded')).toBe('false');
  });
});
