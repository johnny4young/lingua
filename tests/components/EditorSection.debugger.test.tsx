/**
 * RL-027 Slice 1.5 — Settings → Editor → Debugger rows.
 *
 * Pins:
 *   - the master toggle reveal (base) flips `debuggerEnabled`,
 *   - the Clear-all-breakpoints button (fold A) calls `clearAllBreakpoints`
 *     after a confirm prompt and is disabled when no breakpoints exist,
 *   - the "Pause is disabled for all breakpoints" toggle (fold F) drives
 *     `setAllBreakpointsEnabled` in batch,
 *   - Spanish copy renders in neutral LatAm tuteo (`Borra`, `Depurador`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { EditorSection } from '@/components/Settings/EditorSection';
import { useLicenseStore } from '@/stores/licenseStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useDebuggerStore } from '@/stores/debuggerStore';

function setActiveProLicense() {
  useLicenseStore.setState({
    token: 'test.token',
    status: {
      kind: 'active',
      verification: {
        ok: true,
        state: 'active',
        supportWindowEndsAt: Date.now() + 86_400_000,
        payload: {
          productId: 'lingua-desktop',
          tier: 'pro',
          issuedTo: 'test@example.com',
          issuedAt: new Date().toISOString(),
          supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
          entitlements: [],
        },
      },
    },
    lastVerifiedAt: Date.now(),
  });
}

describe('EditorSection — Debugger rows (RL-027 Slice 1.5)', () => {
  const initialSettings = useSettingsStore.getState();
  const initialLicense = useLicenseStore.getState();
  const initialDebugger = useDebuggerStore.getState();

  beforeEach(async () => {
    useSettingsStore.setState(initialSettings, true);
    useLicenseStore.setState(initialLicense, true);
    useDebuggerStore.setState(
      {
        ...initialDebugger,
        breakpoints: {},
        breakpointOrder: [],
        watches: [],
        session: null,
        pausedFrame: null,
        drawerCollapsed: false,
      },
      true
    );
    setActiveProLicense();
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState(initialSettings, true);
    useLicenseStore.setState(initialLicense, true);
    useDebuggerStore.setState(initialDebugger, true);
  });

  it('renders the Debugger master toggle ON by default and flips persistently', async () => {
    const user = userEvent.setup();
    render(<EditorSection />);

    const toggle = screen.getByRole('switch', { name: /^Debugger$/ });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await user.click(toggle);
    expect(useSettingsStore.getState().debuggerEnabled).toBe(false);
  });

  it('Clear-all is disabled when no breakpoints exist (fold A)', () => {
    render(<EditorSection />);
    const clear = screen.getByTestId('settings-debugger-clear-all') as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
  });

  it('Clear-all asks to confirm and then wipes the store (fold A)', async () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 5);
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 7);
    expect(Object.keys(useDebuggerStore.getState().breakpoints)).toHaveLength(2);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<EditorSection />);

    await user.click(screen.getByTestId('settings-debugger-clear-all'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(Object.keys(useDebuggerStore.getState().breakpoints)).toHaveLength(0);
    confirmSpy.mockRestore();
  });

  it('Clear-all aborts when confirm is dismissed (fold A)', async () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 5);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    render(<EditorSection />);

    await user.click(screen.getByTestId('settings-debugger-clear-all'));

    expect(Object.keys(useDebuggerStore.getState().breakpoints)).toHaveLength(1);
    confirmSpy.mockRestore();
  });

  it('Disable-all toggles every breakpoint in batch (fold F)', async () => {
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 3);
    useDebuggerStore.getState().toggleBreakpoint('tab-2', 9);
    const user = userEvent.setup();
    render(<EditorSection />);

    const toggle = screen.getByRole('switch', { name: /Pause is disabled for all breakpoints/i });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await user.click(toggle);

    const bps = Object.values(useDebuggerStore.getState().breakpoints);
    expect(bps.every((bp) => bp.enabled === false)).toBe(true);
    // Re-render reads the updated state — `allBreakpointsDisabled` should be true now.
    expect(
      screen
        .getByRole('switch', { name: /Pause is disabled for all breakpoints/i })
        .getAttribute('aria-checked')
    ).toBe('true');
  });

  it('Disable-all toggle is disabled when there are no breakpoints', () => {
    render(<EditorSection />);
    const toggle = screen.getByRole('switch', {
      name: /Pause is disabled for all breakpoints/i,
    });
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
  });

  it('localizes Debugger rows in neutral LatAm Spanish (tuteo)', async () => {
    await i18next.changeLanguage('es');
    render(<EditorSection />);
    expect(screen.getByRole('switch', { name: /^Depurador$/ })).toBeTruthy();
    // Borra (tuteo) — not "Borrá" (voseo). The button label uses the imperative form.
    expect(screen.getByTestId('settings-debugger-clear-all').textContent).toMatch(/Borra/);
  });
});
