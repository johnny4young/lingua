import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { KeyboardShortcutsModal } from '@/components/KeyboardShortcuts/KeyboardShortcutsModal';

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
    (globalThis as unknown as { window: { lingua?: { platform: string } } }).window = {
      ...(globalThis as unknown as { window: Window }).window,
      lingua: { platform: 'linux' },
    } as unknown as Window;
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Linux x86_64',
    });
    initI18n('en');
    await i18next.changeLanguage('en');
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
    (globalThis as unknown as { window: { lingua?: { platform: string } } }).window = {
      ...(globalThis as unknown as { window: Window }).window,
      lingua: { platform: 'web' },
    } as unknown as Window;
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
