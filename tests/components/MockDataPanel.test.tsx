import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeveloperUtilitiesModal } from '../../src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal';
import { initI18n } from '../../src/renderer/i18n';
import {
  UTILITY_PANEL_WARM_UP_TIMEOUT_MS,
  warmUpUtilityPanels,
} from '../__fixtures__/utilityPanels';

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

// Resolve every lazy panel this file opens before any test runs
// (tests/__fixtures__/utilityPanels.tsx).
beforeAll(() => warmUpUtilityPanels(['mock-data']), UTILITY_PANEL_WARM_UP_TIMEOUT_MS);

describe('MockDataPanel', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  it('uses the JSON syntax output for generated JSON and preserves CSV as plain text', async () => {
    const user = userEvent.setup();
    render(<DeveloperUtilitiesModal onClose={vi.fn()} initialUtilityId="mock-data" />);
    await waitFor(() => expect(screen.queryByTestId('utility-panel-loading')).toBeNull());

    await user.click(screen.getByTestId('mock-data-generate'));
    const jsonOutput = await screen.findByTestId('mock-data-output');
    expect(jsonOutput.tagName).toBe('PRE');
    expect(jsonOutput.textContent).toContain('"id"');

    await user.selectOptions(screen.getByTestId('mock-data-format'), 'csv');
    await user.click(screen.getByTestId('mock-data-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('mock-data-output').tagName).toBe('TEXTAREA');
    });
  });
});
