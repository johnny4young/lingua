import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '@/i18n';
import { PausedConsoleSummary } from '@/components/Console/PausedConsoleSummary';
import { useDebuggerStore } from '@/stores/debuggerStore';
import { useUIStore } from '@/stores/uiStore';

const pause = (line: number, locals: Record<string, string>) =>
  useDebuggerStore.getState().setPausedFrame({ tabId: 't1', line, reason: 'step', locals, callStack: [], watchResults: {} });

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  useDebuggerStore.setState({ pausedFrame: null, previousPause: null, lastPause: null, session: null });
});

describe('paused Console summary', () => {
  it('says where execution waits and opens the Debugger tab', async () => {
    pause(3, { count: '1' });
    render(<PausedConsoleSummary />);
    expect(screen.getByTestId('console-paused-summary').textContent).toContain('Paused at line 3');
    expect(screen.getByText(/Execution waits here/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Open Debugger' }));
    expect(useUIStore.getState().activeBottomPanel).toBe('debugger');
  });

  it('lists what the last step changed', () => {
    pause(3, { count: '1' });
    pause(4, { count: '2', doubled: '4' });
    render(<PausedConsoleSummary />);
    expect(screen.getByTestId('console-paused-summary').textContent).toContain('count → 2  ·  doubled → 4');
  });

  it('renders nothing while running', () => {
    const { container } = render(<PausedConsoleSummary />);
    expect(container.firstChild).toBeNull();
  });
});
