/**
 * internal — Backslash Escape / Unescape panel tests. The pure helper is
 * covered in tests/utils/backslashEscape.test.ts, so this suite only
 * verifies wiring: mode switch, preset switch, live output updates, the
 * SQL wildcard hint, error banner for malformed input, and Spanish locale
 * parity.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';

vi.mock('../../src/renderer/components/ui/chrome', () => ({
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
  OverlayCard: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

describe('BackslashEscapePanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('defaults to JavaScript escape and renders the seeded input escaped', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="backslash-escape" />);

    await waitFor(() => {
      const output = screen.getByTestId('backslash-escape-output') as HTMLTextAreaElement;
      expect(output.value).toBe('Hello,\\n\\"World\\"');
    });
  });

  it('switches to Unescape mode and round-trips the escaped JavaScript back to raw text', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="backslash-escape" />);

    await user.selectOptions(screen.getByTestId('backslash-escape-mode'), 'unescape');

    const input = screen.getByTestId('backslash-escape-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'a\\tb\\u00E9' } });

    await waitFor(() => {
      const output = screen.getByTestId('backslash-escape-output') as HTMLTextAreaElement;
      expect(output.value).toBe('a\tbé');
    });
  });

  it('shows a translated error banner with position info for malformed input', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="backslash-escape" />);

    await user.selectOptions(screen.getByTestId('backslash-escape-mode'), 'unescape');
    const input = screen.getByTestId('backslash-escape-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'a\\x1' } });

    const error = await screen.findByTestId('backslash-escape-error');
    expect(error.textContent).toMatch(/Expected two hex digits/);
    expect(error.textContent).toMatch(/position 1/);
    // Output textarea is replaced by the error banner — no stale output
    // leaking through.
    expect(screen.queryByTestId('backslash-escape-output')).toBeNull();
  });

  it('surfaces the SQL wildcard hint only when the SQL preset is picked', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="backslash-escape" />);

    // Default preset is JavaScript — hint is not visible.
    expect(screen.queryByText(/SQL LIKE wildcards/)).toBeNull();

    await user.selectOptions(screen.getByTestId('backslash-escape-preset'), 'sql-mysql');
    expect(screen.getByText(/SQL LIKE wildcards/)).toBeTruthy();

    // Switch back to JavaScript — hint goes away.
    await user.selectOptions(screen.getByTestId('backslash-escape-preset'), 'javascript');
    expect(screen.queryByText(/SQL LIKE wildcards/)).toBeNull();
  });

  it('lists every preset in the dropdown', () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="backslash-escape" />);

    const select = screen.getByTestId('backslash-escape-preset') as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    expect(values).toEqual(['javascript', 'json', 'python', 'sql-mysql']);
  });

  it('localizes the panel title to Spanish when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="backslash-escape" />);

    expect(
      screen.getByRole('heading', { level: 3, name: /Escape o unescape con barras/ })
    ).toBeTruthy();
  });
});
