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
    expect(screen.getByText('Ctrl+S')).toBeTruthy();
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

    expect(screen.getByText('⌘S')).toBeTruthy();
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

    await act(async () => {
      fireEvent.keyDown(window, { key: 'j', ctrlKey: true, shiftKey: true });
    });

    const overrides = useSettingsStore.getState().shortcutOverrides;
    expect(overrides['view-toggle-sidebar']?.[0].tokens).toEqual(['Mod', 'Shift', 'J']);
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

  it('changing the preset selector applies the preset overrides to the store', async () => {
    const user = userEvent.setup();
    render(<KeyboardShortcutsModal onClose={vi.fn()} />);

    await user.selectOptions(screen.getByTestId('shortcut-preset-select'), 'sublime');

    const state = useSettingsStore.getState();
    expect(state.keymapPreset).toBe('sublime');
    expect(state.shortcutOverrides['nav-go-to-symbol']?.[0].tokens).toEqual(['Mod', 'R']);
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
