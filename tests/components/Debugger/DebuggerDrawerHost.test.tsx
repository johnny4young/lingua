import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { DebuggerDrawerHost } from '@/components/Debugger/DebuggerDrawerHost';

vi.mock('@/components/Debugger/debuggerDrawerLoader', () => ({
  loadDebuggerDrawer: () => Promise.reject(new Error('chunk failed')),
}));

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
});

describe('debugger drawer host', () => {
  it('says the debugger could not load when its chunk fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<DebuggerDrawerHost activeTabId="t1" activeLanguage="javascript" />);
    expect((await screen.findByRole('alert')).textContent).toBe('The debugger could not load. Reload Lingua to try again.');
  });
});
