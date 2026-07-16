/**
 * RL-113 Slice 1 — Cmd+; recent commands stack, end-to-end.
 *
 * Locks the acceptance criteria on the production web build:
 *   - executing palette commands surfaces them in the Cmd+; stack in
 *     reverse execution order (most recent first),
 *   - pressing `1` re-runs the top entry and closes the popover,
 *   - the empty session shows the localized empty state.
 */

import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

const PALETTE_CHORD = process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P';
const RECENT_CHORD = process.platform === 'darwin' ? 'Meta+;' : 'Control+;';

async function runPaletteCommand(page: Page, query: string, optionName: RegExp): Promise<void> {
  await page.keyboard.press(PALETTE_CHORD);
  const input = page.getByPlaceholder('Search templates, snippets, commands...');
  await input.fill(query);
  await page.getByRole('option', { name: optionName }).first().click();
}

test.describe('recent commands stack (RL-113)', () => {
  test('executed commands stack most-recent-first and 1 re-runs + closes', async ({ page }) => {
    await seedSession(page);
    await gotoApp(page);

    // Two distinct palette actions, in a known order.
    await runPaletteCommand(page, 'Layout: Horizontal', /Layout: Horizontal Split/i);
    await runPaletteCommand(page, 'Layout: Vertical', /Layout: Vertical Split/i);

    await page.keyboard.press(RECENT_CHORD);
    const slots = page.getByTestId('recent-command-slot');
    await expect(slots.first()).toHaveText('1');
    const options = page.getByRole('option');
    await expect(options.nth(0)).toContainText(/Vertical Split/i);
    await expect(options.nth(1)).toContainText(/Horizontal Split/i);
    await expect(page.getByTestId('recent-command-time').first()).toBeVisible();

    // `1` re-runs the most recent command and dismisses the popover.
    await page
      .getByPlaceholder('Press 1-8 to run again, Enter for the most recent…')
      .press('1');
    await expect(page.getByTestId('recent-command-slot')).toHaveCount(0);
  });

  test('an untouched session shows the localized empty state', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await page.keyboard.press(RECENT_CHORD);
    await expect(
      page.getByText('Aún no has ejecutado comandos en esta sesión.')
    ).toBeVisible();
  });
});
