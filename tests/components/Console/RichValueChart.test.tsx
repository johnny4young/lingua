/**
 * accessibility pass — focus management for the rich-chart actions menu.
 *
 * The chart's Vega rendering is irrelevant here (and stubbed), so these
 * tests only exercise the actions popover: focus moves into the menu on
 * open, ↑↓ rove the items, and Escape returns focus to the trigger.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initI18n } from '@/i18n';

// Stub the lazy Vega import so the component never touches a real canvas.
vi.mock('vega-embed', () => ({
  default: () =>
    Promise.resolve({
      view: { toSVG: async () => '<svg/>', toCanvas: async () => document.createElement('canvas') },
      finalize: () => undefined,
    }),
}));

// Pro entitlement on, so both SVG + PNG menu items render (two rove targets).
vi.mock('@/hooks/useEntitlement', () => ({
  useEntitlement: () => true,
}));

import { RichValueChart } from '@/components/Console/RichValueChart';

describe('RichValueChart actions menu — focus management (accessibility pass)', () => {
  beforeEach(async () => {
    await initI18n();
    await i18next.changeLanguage('en');
  });

  function openMenu() {
    render(<RichValueChart payload={{ kind: 'chart', spec: {} }} />);
    return screen.getByTestId('console-rich-chart-actions');
  }

  it('moves focus to the first action when the menu opens', async () => {
    const user = userEvent.setup();
    const trigger = openMenu();
    await user.click(trigger);
    const items = await screen.findAllByRole('menuitem');
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
  });

  it('roves the actions with ArrowDown / End', async () => {
    const user = userEvent.setup();
    const trigger = openMenu();
    await user.click(trigger);
    const items = await screen.findAllByRole('menuitem');
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('returns focus to the trigger on Escape', async () => {
    const user = userEvent.setup();
    const trigger = openMenu();
    await user.click(trigger);
    await screen.findByTestId('console-rich-chart-menu');
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByTestId('console-rich-chart-menu')).toBeNull()
    );
    expect(document.activeElement).toBe(trigger);
  });
});
