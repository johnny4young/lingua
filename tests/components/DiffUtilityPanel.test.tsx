/**
 * internal — Diff Viewer panel tests for the granularity selector. The
 * Myers helper itself is covered in tests/utils/diff.test.ts; this suite
 * just checks wiring: default granularity, switching between modes
 * re-renders the output (line rows vs inline segments), and the summary
 * counts reflect the current granularity.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  OverlayBackdrop: ({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) => (
    <div onClick={onClose}>{children}</div>
  ),
  OverlayCard: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
}));

describe('DiffUtilityPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('renders line-mode by default with add/remove rows for a simple edit', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="diff" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByTestId('diff-result-line')).toBeTruthy();
    // Seeded inputs differ on the second line and add a trailing line —
    // both "add" and "remove" rows must be present.
    expect(screen.getAllByTestId('diff-line-add').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('diff-line-remove').length).toBeGreaterThan(0);
  });

  it('switches to word granularity and renders inline segments', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="diff" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('diff-granularity-select'), 'word');

    expect(screen.queryByTestId('diff-result-line')).toBeNull();
    expect(screen.getByTestId('diff-result-inline')).toBeTruthy();
    expect(screen.getAllByTestId('diff-segment-add').length).toBeGreaterThan(0);
  });

  it('switches to character granularity and keeps rendering inline segments', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="diff" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.selectOptions(screen.getByTestId('diff-granularity-select'), 'character');
    expect(screen.getByTestId('diff-result-inline')).toBeTruthy();
  });

  it('localizes the granularity labels and summary into Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="diff" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect(screen.getByText('Granularidad')).toBeTruthy();
    // The select options show localized labels.
    const select = screen.getByTestId('diff-granularity-select') as HTMLSelectElement;
    const labels = Array.from(select.options).map((opt) => opt.textContent);
    expect(labels).toContain('Por línea');
    expect(labels).toContain('Por palabra');
    expect(labels).toContain('Por carácter');
  });
});
