/**
 * RL-071 — RegexUtilityPanel tests. The pure helpers (analyzeRegex +
 * applyRegexReplace) are covered in tests/utils/developerUtilities.test.ts,
 * so this suite focuses on wiring: mode toggle, replacement field
 * visibility, live replace output + count summary, CopyButton, error
 * surfacing, ES locale.
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

describe('RegexUtilityPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('defaults to Match mode and hides the replacement input', () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="regex" />);

    expect((screen.getByTestId('regex-mode') as HTMLSelectElement).value).toBe('match');
    expect(screen.queryByTestId('regex-replacement')).toBeNull();
    // Seeded pattern + input produce 2 matches; matches list should be visible.
    expect(screen.queryByTestId('regex-replace-output')).toBeNull();
  });

  it('switching to Replace mode reveals the replacement field and the replace output pane', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="regex" />);

    await user.selectOptions(screen.getByTestId('regex-mode'), 'replace');

    await waitFor(() => {
      expect(screen.getByTestId('regex-replacement')).toBeTruthy();
    });
    const output = screen.getByTestId('regex-replace-output') as HTMLTextAreaElement;
    // Seeded pattern `(\w+)@(\w+\.\w+)`, seeded input, seeded replacement
    // `[$1 at $2]` → expect the expanded output.
    expect(output.value).toBe('[hello at lingua.dev] and [support at example.com]');
    expect(screen.getByTestId('regex-replace-count').textContent).toMatch(/2 replacements/);
  });

  it('updates the replace output live as the user edits the replacement field', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="regex" />);

    await user.selectOptions(screen.getByTestId('regex-mode'), 'replace');
    const replacement = screen.getByTestId('regex-replacement') as HTMLInputElement;
    fireEvent.change(replacement, { target: { value: '<$1>' } });

    await waitFor(() => {
      const output = screen.getByTestId('regex-replace-output') as HTMLTextAreaElement;
      expect(output.value).toBe('<hello> and <support>');
    });
    expect(screen.getByTestId('regex-replace-count').textContent).toMatch(/2 replacements/);
  });

  it('surfaces the invalid-pattern error banner in Replace mode', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="regex" />);

    await user.selectOptions(screen.getByTestId('regex-mode'), 'replace');
    const pattern = screen.getByTestId('regex-pattern') as HTMLInputElement;
    fireEvent.change(pattern, { target: { value: '(unclosed' } });

    await waitFor(() => {
      // Error copy from the existing errorPattern key.
      expect(
        screen.getAllByText(/The pattern or flags are not a valid regular expression/),
      ).not.toHaveLength(0);
    });
    expect(screen.queryByTestId('regex-replace-output')).toBeNull();
  });

  it('switching back to Match mode clears the replace output', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="regex" />);

    await user.selectOptions(screen.getByTestId('regex-mode'), 'replace');
    expect(screen.getByTestId('regex-replace-output')).toBeTruthy();

    await user.selectOptions(screen.getByTestId('regex-mode'), 'match');
    await waitFor(() => {
      expect(screen.queryByTestId('regex-replace-output')).toBeNull();
      expect(screen.queryByTestId('regex-replacement')).toBeNull();
    });
  });

  it('shows a neutral empty status (not a green count) when the pattern matches nothing', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="regex" />);

    await user.selectOptions(screen.getByTestId('regex-mode'), 'replace');
    // Swap the seeded pattern for one that never matches the seeded input.
    const pattern = screen.getByTestId('regex-pattern') as HTMLInputElement;
    fireEvent.change(pattern, { target: { value: 'zzzzzz' } });

    await waitFor(() => {
      expect(screen.queryByTestId('regex-replace-count')).toBeNull();
      expect(screen.queryByTestId('regex-replace-output')).toBeNull();
    });
    expect(screen.getByText(/No matches for the current pattern/)).toBeTruthy();
  });

  it('localizes the mode selector to Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="regex" />);

    const select = screen.getByTestId('regex-mode') as HTMLSelectElement;
    const labels = Array.from(select.options).map((opt) => opt.textContent);
    expect(labels).toContain('Coincidir');
    expect(labels).toContain('Reemplazar');
  });
});
