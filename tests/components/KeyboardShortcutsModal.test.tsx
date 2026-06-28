import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { KeyboardShortcutsModal } from '@/components/KeyboardShortcuts/KeyboardShortcutsModal';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';

vi.mock('@/components/ui/chrome', () => ({
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  OverlayBackdrop: ({
    children,
    onClose,
  }: {
    children: React.ReactNode;
    onClose?: () => void;
  }) => <div onClick={onClose}>{children}</div>,
  OverlayCard: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

describe('KeyboardShortcutsModal', () => {
  beforeEach(async () => {
    (window as unknown as { lingua?: { platform: string } }).lingua = { platform: 'linux' };
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Linux x86_64',
    });
    initI18n('en');
    await i18next.changeLanguage('en');
    useSettingsStore.getState().resetShortcutOverrides();
    useUIStore.getState().dismissStatusNotice();
  });

  it('renders the catalog grouped into sections with rendered combos', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    expect(screen.getByTestId('keyboard-shortcuts-modal')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'All built-in shortcuts' })).toBeTruthy();
    // Group headings
    expect(screen.getByText('File')).toBeTruthy();
    expect(screen.getByText('Navigation')).toBeTruthy();
    // A concrete combo label for save
    expect(screen.getByTestId('file-save-combo-0').getAttribute('aria-label')).toBe('Ctrl+S');
    // UX Sweep T1 — the per-row Edit affordance carries the focus ring.
    expect(
      screen.getByTestId('shortcut-edit-view-toggle-sidebar').className
    ).toContain('focus-ring');
  });

  it('filters visible shortcuts as the user types in the search field', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Search shortcuts'), 'sidebar');

    expect(screen.getByText('Toggle sidebar')).toBeTruthy();
    // "Save" should not be visible any longer
    expect(screen.queryByText('Save')).toBeNull();
  });

  it('renders mac glyph combos in the web build when the browser runs on macOS', () => {
    (window as unknown as { lingua?: { platform: string } }).lingua = { platform: 'web' };
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });

    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    expect(screen.getByTestId('file-save-combo-0').getAttribute('aria-label')).toBe('⌘S');
  });

  it('renders each shortcut token as a separate visual segment so mac glyphs keep spacing', () => {
    (window as unknown as { lingua?: { platform: string } }).lingua = { platform: 'web' };
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });

    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    const combo = screen.getByTestId('file-save-as-combo-0');
    expect(combo.getAttribute('aria-label')).toBe('⌘⇧S');
    expect(combo.querySelectorAll('[data-shortcut-token]')).toHaveLength(3);
  });

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Search shortcuts'), 'zzzzzz');

    expect(screen.getByText('No shortcuts match "zzzzzz".')).toBeTruthy();
  });

  it('records a new combo when the user presses keys while editing a row', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    await user.click(screen.getByTestId('shortcut-edit-view-toggle-sidebar'));

    // `Mod+Shift+U` is a free combo in the production catalog —
    // verified by `tests/data/keyboardShortcuts.test.ts` (no two
    // shortcut ids share a combo). The earlier choice was `Mod+Shift+J`
    // but RL-025 Slice A bound that to `view-show-dependencies`; the
    // follow-up choice `Mod+Shift+Y` was taken by RL-094 Slice 2
    // (capsule import overlay). U remains free.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'u', ctrlKey: true, shiftKey: true });
    });

    const overrides = useSettingsStore.getState().shortcutOverrides;
    expect(overrides['view-toggle-sidebar']?.[0].tokens).toEqual(['Mod', 'Shift', 'U']);
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('shortcuts.editor.rebound');
  });

  it('refuses to record a combo that is already bound and surfaces a notice', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    await user.click(screen.getByTestId('shortcut-edit-view-toggle-sidebar'));

    await act(async () => {
      // Mod+S is bound to file-save in the default catalog
      fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    });

    expect(useSettingsStore.getState().shortcutOverrides['view-toggle-sidebar']).toBeUndefined();
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('shortcuts.editor.conflict');
  });

  it('rejects plain typing keys so shortcuts do not steal editor input', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    await user.click(screen.getByTestId('shortcut-edit-view-toggle-sidebar'));

    await act(async () => {
      fireEvent.keyDown(window, { key: 'j' });
    });

    expect(useSettingsStore.getState().shortcutOverrides['view-toggle-sidebar']).toBeUndefined();
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('shortcuts.editor.invalidCombo');
  });

  it('leaves browser hard-refresh shortcuts untouched while recording', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    await user.click(screen.getByTestId('shortcut-edit-view-toggle-sidebar'));

    await act(async () => {
      fireEvent.keyDown(window, { key: 'r', ctrlKey: true, shiftKey: true });
    });

    expect(useSettingsStore.getState().shortcutOverrides['view-toggle-sidebar']).toBeUndefined();
    expect(useUIStore.getState().statusNotice).toBeNull();
  });

  it('changing the preset selector applies the preset overrides to the store', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    // No overrides present (clean beforeEach), so the wipe is harmless and
    // applies immediately without a confirm dialog.
    await user.selectOptions(screen.getByTestId('shortcut-preset-select'), 'sublime');

    const state = useSettingsStore.getState();
    expect(state.keymapPreset).toBe('sublime');
    expect(state.shortcutOverrides['nav-go-to-symbol']?.[0].tokens).toEqual(['Mod', 'R']);
    // No confirm dialog when there was nothing to lose.
    expect(screen.queryByTestId('shortcut-preset-confirm')).toBeNull();
  });

  it('does NOT confirm a preset change on mount or a no-op same-preset selection', async () => {
    const user = userEvent.setup();
    // Start on a preset with overrides present.
    useSettingsStore.getState().applyKeymapPreset('sublime');
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    // Mount alone never fires the confirm.
    expect(screen.queryByTestId('shortcut-preset-confirm')).toBeNull();

    // Re-selecting the SAME preset is a no-op and must not confirm.
    await user.selectOptions(screen.getByTestId('shortcut-preset-select'), 'sublime');
    expect(screen.queryByTestId('shortcut-preset-confirm')).toBeNull();
  });

  it('confirms before wiping overrides when switching to a different preset', async () => {
    const user = userEvent.setup();
    // Seed real custom overrides (keymapPreset flips to default).
    useSettingsStore
      .getState()
      .setShortcutOverride('view-toggle-sidebar', [{ tokens: ['Mod', 'Shift', 'B'] }]);
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    await user.selectOptions(screen.getByTestId('shortcut-preset-select'), 'sublime');

    // The change is gated behind the confirm — store is untouched so far.
    expect(screen.getByTestId('shortcut-preset-confirm')).toBeTruthy();
    expect(useSettingsStore.getState().keymapPreset).toBe('default');
    expect(
      useSettingsStore.getState().shortcutOverrides['view-toggle-sidebar']
    ).toBeTruthy();

    // Cancel aborts with no mutation.
    await user.click(screen.getByTestId('shortcut-preset-confirm-cancel'));
    expect(useSettingsStore.getState().keymapPreset).toBe('default');
    expect(screen.queryByTestId('shortcut-preset-confirm')).toBeNull();

    // Re-open and confirm — now the preset applies.
    await user.selectOptions(screen.getByTestId('shortcut-preset-select'), 'sublime');
    await user.click(screen.getByTestId('shortcut-preset-confirm-confirm'));
    expect(useSettingsStore.getState().keymapPreset).toBe('sublime');
  });

  it('reset-all clears every override', async () => {
    useSettingsStore
      .getState()
      .setShortcutOverride('view-toggle-sidebar', [{ tokens: ['Mod', 'Shift', 'B'] }]);
    useSettingsStore
      .getState()
      .setShortcutOverride('view-toggle-console', [{ tokens: ['Mod', 'Shift', 'Backslash'] }]);

    const user = userEvent.setup();
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    await user.click(screen.getByTestId('shortcut-reset-all'));

    expect(useSettingsStore.getState().shortcutOverrides).toEqual({});
  });

  it('hides the Edit affordance for the Escape / close-overlay shortcut', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    expect(screen.queryByTestId('shortcut-edit-overlay-close')).toBeNull();
  });

  it('renders export/import buttons and disables export when there are no overrides', () => {
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    const exportBtn = screen.getByTestId('shortcut-export');
    const importBtn = screen.getByTestId('shortcut-import');
    expect(exportBtn.hasAttribute('disabled')).toBe(true);
    expect(importBtn.hasAttribute('disabled')).toBe(false);
  });

  it('enables export once the user has customized at least one shortcut', () => {
    useSettingsStore
      .getState()
      .setShortcutOverride('view-toggle-sidebar', [{ tokens: ['Mod', 'Shift', 'B'] }]);

    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    expect(screen.getByTestId('shortcut-export').hasAttribute('disabled')).toBe(false);
  });

  it('imports immediately when there are no overrides to overwrite', async () => {
    const user = userEvent.setup();
    const selectFile = vi.fn().mockResolvedValue({ canceled: true });
    (window as unknown as { lingua: { fs: { selectFile: typeof selectFile } } }).lingua = {
      ...(window as unknown as { lingua: object }).lingua,
      fs: { selectFile },
    } as never;

    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    await user.click(screen.getByTestId('shortcut-import'));

    // No overrides → clean seed → no confirm, picker opens directly.
    expect(screen.queryByTestId('shortcut-import-confirm')).toBeNull();
    expect(selectFile).toHaveBeenCalledTimes(1);
  });

  it('confirms before an import overwrites existing overrides', async () => {
    const user = userEvent.setup();
    const selectFile = vi.fn().mockResolvedValue({ canceled: true });
    (window as unknown as { lingua: { fs: { selectFile: typeof selectFile } } }).lingua = {
      ...(window as unknown as { lingua: object }).lingua,
      fs: { selectFile },
    } as never;

    useSettingsStore
      .getState()
      .setShortcutOverride('view-toggle-sidebar', [{ tokens: ['Mod', 'Shift', 'B'] }]);

    render(<KeyboardShortcutsModal onClose={vi.fn()} />);
    await user.click(screen.getByTestId('shortcut-import'));

    // The picker must NOT open until the user confirms the overwrite.
    expect(screen.getByTestId('shortcut-import-confirm')).toBeTruthy();
    expect(selectFile).not.toHaveBeenCalled();

    // Cancel aborts — picker stays closed.
    await user.click(screen.getByTestId('shortcut-import-confirm-cancel'));
    expect(selectFile).not.toHaveBeenCalled();

    // Confirm proceeds to the picker.
    await user.click(screen.getByTestId('shortcut-import'));
    await user.click(screen.getByTestId('shortcut-import-confirm-confirm'));
    expect(selectFile).toHaveBeenCalledTimes(1);
  });

  it('fires onClose when the close affordance is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<KeyboardShortcutsModal onClose={onClose} />);

    // The mocked OverlayBackdrop bubbles clicks to its root wrapper, so the
    // exact call count depends on propagation; this assertion only cares
    // that the close button reaches the handler at least once.
    await user.click(screen.getByLabelText('Close keyboard shortcuts'));
    expect(onClose).toHaveBeenCalled();
  });
});
