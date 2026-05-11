import { fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByTestId('debugger-empty').textContent).toContain(
      'Click the gutter on a JS or TS file to set a breakpoint.'
    );
    expect(screen.getByTestId('debugger-continue').hasAttribute('disabled')).toBe(true);
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
    expect(screen.getByTestId('debugger-watches').textContent).toContain(
      'Pending evaluation'
    );

    fireEvent.click(screen.getByTestId('debugger-step-over'));

    expect(postDebuggerMessage).toHaveBeenCalledWith({ type: 'step', mode: 'over' });
    expect(useDebuggerStore.getState().pausedFrame).toBeNull();
  });

  it('chevron toggles drawerCollapsed and hides the body (Slice 1.5 fold B)', () => {
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
