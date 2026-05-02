/**
 * RL-037 Vim mode toggle.
 *
 * The settings toggle persists the `vimMode` flag and the editor surface
 * lazy-loads `monaco-vim` against it. These tests pin the toggle UI
 * contract: default-off, flips persistently on click, label localizes
 * to tuteo Spanish, and Free-tier still gates extended editor fonts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { EditorSection } from '@/components/Settings/EditorSection';
import { useLicenseStore } from '@/stores/licenseStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';

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

describe('EditorSection — Vim mode toggle (RL-037)', () => {
  const initial = useSettingsStore.getState();
  const initialLicense = useLicenseStore.getState();

  beforeEach(async () => {
    useSettingsStore.setState(initial, true);
    useLicenseStore.setState(initialLicense, true);
    setActiveProLicense();
    useUIStore.setState({ statusNotice: null });
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState(initial, true);
    useLicenseStore.setState(initialLicense, true);
  });

  it('renders the Vim mode toggle unchecked by default and drops the legacy pending note', () => {
    render(<EditorSection />);
    const toggle = screen.getByRole('switch', { name: /Vim mode/i });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    // The pendingNote shipped with the placeholder slice is gone now that
    // the toggle drives a real `monaco-vim` integration.
    expect(screen.queryByTestId('editor-vim-mode-status')).toBeNull();
  });

  it('flips the persisted vimMode flag when the toggle is clicked', async () => {
    const user = userEvent.setup();
    render(<EditorSection />);

    const toggle = screen.getByRole('switch', { name: /Vim mode/i });
    await user.click(toggle);

    expect(useSettingsStore.getState().vimMode).toBe(true);
    expect(screen.getByRole('switch', { name: /Vim mode/i }).getAttribute('aria-checked')).toBe(
      'true'
    );
  });

  it('localizes the label in tuteo Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<EditorSection />);

    expect(screen.getByRole('switch', { name: /Modo Vim/i })).toBeTruthy();
  });

  it('blocks extended editor fonts on the Free tier', async () => {
    useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
    const user = userEvent.setup();
    render(<EditorSection />);

    await user.selectOptions(screen.getByTestId('editor-font-family-select'), 'Menlo, monospace');

    expect(useSettingsStore.getState().fontFamily).toBe(
      "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace"
    );
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('upsell.freeCeilingReached');
  });
});
