import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';
import { UTILITY_PANEL_WARM_UP_TIMEOUT_MS, warmUpUtilityPanels } from '../__fixtures__/utilityPanels';

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  Kbd: ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>,
  IconButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  OverlayBackdrop: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  OverlayCard: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

beforeAll(() => warmUpUtilityPanels(['timestamp']), UTILITY_PANEL_WARM_UP_TIMEOUT_MS);

describe('TimestampUtilityPanel answer', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('answers with how far the moment is from now and names how the input was read', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 11, 13, 2, 0));
    try {
      render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="timestamp" />);
      await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());
      const input = screen.getByLabelText('Input');
      const header = within(screen.getByTestId('timestamp-result-header'));

      fireEvent.change(input, { target: { value: String(Date.UTC(2026, 10, 11, 10, 2, 0) / 1000) } });
      expect(header.getByTestId('result-header-tag').textContent).toBe('TIME');
      expect(header.getByTestId('result-header-numeral').textContent).toBe('3hr. ago');
      expect(header.getByTestId('result-header-meta').textContent).toBe('epoch seconds');

      fireEvent.change(input, { target: { value: String(Date.UTC(2026, 10, 14, 13, 2, 0)) } });
      expect(header.getByTestId('result-header-numeral').textContent).toBe('in3days');
      expect(header.getByTestId('result-header-meta').textContent).toBe('epoch milliseconds');

      fireEvent.change(input, { target: { value: 'not a date' } });
      expect(header.getByTestId('result-header-numeral').textContent).toBe('invalid');
      expect(header.queryByTestId('result-header-meta')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
