/**
 * internal — CronParserPanel tests. Helper coverage lives in
 * tests/utils/cronParser.test.ts, so this suite focuses on wiring:
 * default render, description + next-runs visibility, empty state,
 * invalid-expression error banner, upcoming-runs count input, ES
 * locale translation.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

describe('CronParserPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('renders the seeded expression plus a description and 5 next-run rows', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="cron-parser" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    expect((screen.getByTestId('cron-parser-input') as HTMLInputElement).value).toBe('*/5 * * * *');
    expect((screen.getByTestId('cron-parser-next-count') as HTMLInputElement).value).toBe('5');

    await waitFor(() => {
      const description = screen.getByTestId('cron-parser-description') as HTMLTextAreaElement;
      expect(description.value.toLowerCase()).toContain('every 5 minutes');
    });

    const rows = within(screen.getByTestId('cron-parser-next-runs')).getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(screen.getByTestId('cron-parser-next-row-0')).toBeTruthy();
    expect(screen.getByTestId('cron-parser-next-row-4')).toBeTruthy();
  });

  it('updates the run count when the upcoming-runs input changes', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="cron-parser" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await waitFor(() => {
      expect(within(screen.getByTestId('cron-parser-next-runs')).getAllByRole('listitem')).toHaveLength(5);
    });

    const countInput = screen.getByTestId('cron-parser-next-count') as HTMLInputElement;
    fireEvent.change(countInput, { target: { value: '2' } });

    await waitFor(() => {
      expect(within(screen.getByTestId('cron-parser-next-runs')).getAllByRole('listitem')).toHaveLength(2);
    });
  });

  it('shows the invalid-expression error banner for garbage input', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="cron-parser" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    const input = screen.getByTestId('cron-parser-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'not a cron' } });

    await waitFor(() => {
      expect(screen.getByText(/Invalid cron expression/)).toBeTruthy();
      expect(screen.queryByTestId('cron-parser-description')).toBeNull();
      expect(screen.queryByTestId('cron-parser-next-runs')).toBeNull();
    });
  });

  it('shows the empty-state hint when the expression is cleared', async () => {
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="cron-parser" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await waitFor(() => {
      expect(screen.getByTestId('cron-parser-description')).toBeTruthy();
    });

    const input = screen.getByTestId('cron-parser-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });

    await waitFor(() => {
      expect(
        screen.getByText(/Enter a cron expression above to see the schedule/),
      ).toBeTruthy();
      expect(screen.queryByTestId('cron-parser-description')).toBeNull();
    });
  });

  it('localizes the description to Spanish when the locale switches', async () => {
    await i18next.changeLanguage('es');
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="cron-parser" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await waitFor(() => {
      const description = screen.getByTestId('cron-parser-description') as HTMLTextAreaElement;
      expect(description.value.toLowerCase()).toContain('cada 5 minutos');
    });

    // Panel title renders in Spanish too.
    expect(screen.getByRole('heading', { level: 3, name: /Cron Parser/i })).toBeTruthy();
  });
});
