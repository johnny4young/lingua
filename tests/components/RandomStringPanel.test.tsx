/**
 * RL-068 — RandomStringPanel tests. The pure helper is covered in
 * tests/utils/randomString.test.ts, so this suite focuses on wiring:
 * default toggle state, generate click produces N rows with per-row
 * CopyButton, empty-charset banner disables Generate, ES locale copy.
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

describe('RandomStringPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('renders with the default 32-char length, count-5, and Lowercase + Uppercase + Digits on', () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="random-string" />);

    expect((screen.getByTestId('random-string-length') as HTMLInputElement).value).toBe('32');
    expect((screen.getByTestId('random-string-count') as HTMLInputElement).value).toBe('5');
    expect(
      (screen.getByTestId('random-string-toggle-lowercase') as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByTestId('random-string-toggle-uppercase') as HTMLInputElement).checked,
    ).toBe(true);
    expect((screen.getByTestId('random-string-toggle-digits') as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (screen.getByTestId('random-string-toggle-symbols') as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByTestId('random-string-toggle-excludeAmbiguous') as HTMLInputElement).checked,
    ).toBe(false);
    // No values yet — output shows the empty placeholder.
    expect(screen.queryByTestId('random-string-value')).toBeNull();
  });

  it('generates count rows of length chars when the user clicks Generate', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="random-string" />);

    await user.click(screen.getByTestId('random-string-generate'));

    await waitFor(() => {
      expect(screen.getAllByTestId('random-string-value')).toHaveLength(5);
    });
    for (const row of screen.getAllByTestId('random-string-value')) {
      const text = row.textContent ?? '';
      // Strip the CopyButton label (which may show as icon text in the
      // mocked IconButton stand-in); the value is the truncated span's
      // text. The row contains the value followed by the copy affordance,
      // so the first 32 chars should match the alphanumeric pool.
      const valueSpan = row.querySelector('span');
      expect(valueSpan?.textContent ?? '').toMatch(/^[A-Za-z0-9]{32}$/);
      // Ensure we did not swallow the value in the button text extraction.
      expect(text.length).toBeGreaterThanOrEqual(32);
    }
  });

  it('respects the Count input when Generate is clicked', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="random-string" />);

    const countInput = screen.getByTestId('random-string-count') as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: '2' } });

    await user.click(screen.getByTestId('random-string-generate'));

    await waitFor(() => {
      expect(screen.getAllByTestId('random-string-value')).toHaveLength(2);
    });
  });

  it('shows an error banner and disables Generate when every charset toggle is off', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="random-string" />);

    await user.click(screen.getByTestId('random-string-toggle-lowercase'));
    await user.click(screen.getByTestId('random-string-toggle-uppercase'));
    await user.click(screen.getByTestId('random-string-toggle-digits'));
    // Symbols + excludeAmbiguous remain off from the default.

    const banner = screen.getByTestId('random-string-error');
    expect(banner.textContent).toMatch(/at least one character class/i);

    const generate = screen.getByTestId('random-string-generate') as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
  });

  it('honours Exclude Ambiguous so 0, 1, l, o never appear in the output', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="random-string" />);

    await user.click(screen.getByTestId('random-string-toggle-excludeAmbiguous'));
    // Leave Lowercase + Uppercase + Digits ON — the ambiguous set
    // includes 0, O, o, 1, l, I, and |. Symbols stays OFF so no pipe
    // exposure even without the toggle.
    await user.click(screen.getByTestId('random-string-generate'));

    await waitFor(() => {
      expect(screen.getAllByTestId('random-string-value')).toHaveLength(5);
    });
    for (const row of screen.getAllByTestId('random-string-value')) {
      const value = row.querySelector('span')?.textContent ?? '';
      for (const forbidden of ['0', 'O', 'o', '1', 'l', 'I', '|']) {
        expect(value).not.toContain(forbidden);
      }
    }
  });

  it('renders per-row copy buttons with indexed testids (random-string-value-copy-0, -1, …)', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="random-string" />);

    await user.click(screen.getByTestId('random-string-generate'));

    await waitFor(() => {
      expect(screen.getAllByTestId('random-string-value')).toHaveLength(5);
    });
    for (let i = 0; i < 5; i += 1) {
      expect(screen.getByTestId(`random-string-value-copy-${i}`)).toBeTruthy();
    }
  });

  it('localizes the generate action to Spanish when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="random-string" />);

    expect(
      screen.getByRole('heading', { level: 3, name: /Generar cadenas aleatorias/ }),
    ).toBeTruthy();
    const button = screen.getByTestId('random-string-generate');
    expect(button.textContent).toBe('Generar');
  });
});
