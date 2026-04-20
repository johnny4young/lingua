/**
 * RL-037 Vim mode toggle — first implementation increment.
 *
 * The settings toggle persists the `vimMode` flag so the next slice (which
 * lazy-loads `monaco-vim`) can gate on it. This slice ships only the flag
 * + the toggle UI; flipping it today does NOT change editor behavior.
 * These tests pin that contract so the follow-up slice can build on it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { EditorSection } from '@/components/Settings/EditorSection';
import { useSettingsStore } from '@/stores/settingsStore';

describe('EditorSection — Vim mode toggle (RL-037)', () => {
  const initial = useSettingsStore.getState();

  beforeEach(async () => {
    useSettingsStore.setState(initial, true);
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState(initial, true);
  });

  it('renders the Vim mode toggle unchecked by default', () => {
    render(<EditorSection />);
    const toggle = screen.getByRole('switch', { name: /Vim mode/i });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('editor-vim-mode-status').textContent).toContain(
      'Flag only today'
    );
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

  it('localizes the label and pending note in Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<EditorSection />);

    expect(screen.getByRole('switch', { name: /Modo Vim/i })).toBeTruthy();
    expect(screen.getByTestId('editor-vim-mode-status').textContent).toContain(
      'Hoy solo persiste el flag'
    );
  });
});
