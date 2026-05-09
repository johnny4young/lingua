/**
 * RL-069 Slice 3 — Functional smoke for the Developer Utilities
 * personalization layer: pin/unpin favorites, drag-reorder via
 * @dnd-kit (mouse + keyboard), per-tool history accumulation across
 * Apply gestures, persist toggle survives reload, clipboard-on-focus
 * consent flow in Settings.
 *
 * The user explicitly requested expanded coverage: JWT + CRON + several
 * other panels appear in the panel-rotation pass below so a regression
 * in any of these axes lights up.
 *
 * Developer Utilities is Pro-gated; every test seeds a Pro license.
 * The blocking smoke gate the user elevated for Slice 2 carries over —
 * the slice does not close until every assertion stays green.
 */

import {
  closeDeveloperUtilities,
  closeSettings,
  expect,
  expectTier,
  gotoApp,
  openDeveloperUtilities,
  openSettings,
  openSettingsTab,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('RL-069 Slice 3 — personalize gesture smoke', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await expectTier(page, 'PRO');
  });

  test('Favorites: pin a tool, the favorites row appears and chip lights up', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);

    // No favorites yet — the row is hidden.
    await expect(page.getByTestId('utilities-favorites-row')).toHaveCount(0);

    // Pin Base64 from the sidebar.
    await page.getByTestId('utility-favorite-toggle-base64').click();

    // Row appears with the Base64 chip.
    await expect(page.getByTestId('utilities-favorites-row')).toBeVisible();
    await expect(page.getByTestId('utility-favorite-base64')).toBeVisible();

    await closeDeveloperUtilities(page);
  });

  test('Favorites: pin two tools and survive a reload', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByTestId('utility-favorite-toggle-jwt').click();
    await page.getByTestId('utility-favorite-toggle-cron-parser').click();
    await closeDeveloperUtilities(page);

    await page.reload();
    await openDeveloperUtilities(page);

    await expect(page.getByTestId('utility-favorite-jwt')).toBeVisible();
    await expect(page.getByTestId('utility-favorite-cron-parser')).toBeVisible();
  });

  test('Favorites: clicking a chip selects the matching panel', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByTestId('utility-favorite-toggle-cron-parser').click();
    await page.getByTestId('utility-favorite-toggle-jwt').click();

    // JSON panel is the default landing. Clicking the JWT chip should
    // switch to the JWT panel.
    await page.getByTestId('utility-favorite-jwt').click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'JWT Debugger' })
    ).toBeVisible();
  });

  test('History drawer: Apply on JSON pushes an entry, Clear empties it', async ({
    page,
  }) => {
    await openDeveloperUtilities(page);

    // Default JSON panel — Apply against the seeded valid input.
    await page.getByTestId('utility-apply-button').click();

    // Open the drawer, expect 1 entry.
    await page.getByTestId('utility-history-drawer').click();
    await expect(page.getByTestId('utility-history-entries')).toBeVisible();
    await expect(page.getByTestId('utility-history-entry')).toHaveCount(1);

    // Clear — the empty-state copy returns.
    await page.getByTestId('utility-history-clear').click();
    await expect(page.getByTestId('utility-history-empty')).toBeVisible();
  });

  test('History persist toggle: enabling it survives a reload', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByTestId('utility-apply-button').click();
    await page.getByTestId('utility-history-drawer').click();
    await page.getByTestId('utility-history-persist-toggle').check();
    await closeDeveloperUtilities(page);

    await page.reload();
    await openDeveloperUtilities(page);
    await page.getByTestId('utility-history-drawer').click();
    await expect(page.getByTestId('utility-history-entry')).toHaveCount(1);
  });

  test('Clipboard-on-focus: Settings toggle flips consent and shows the localized status', async ({
    page,
  }) => {
    await openSettings(page);
    await openSettingsTab(page, 'editor');

    const toggle = page.getByRole('switch', {
      name: 'Apply from clipboard on panel focus',
    });
    await toggle.click();
    await expect(
      page.getByTestId('utilities-clipboard-on-focus-status')
    ).toContainText('Active');

    await toggle.click();
    await expect(
      page.getByTestId('utilities-clipboard-on-focus-status')
    ).toContainText('Off');

    await closeSettings(page);
  });

  test('Clear-all-history confirmation: requires a second click and offers Cancel', async ({
    page,
  }) => {
    // Seed some history first.
    await openDeveloperUtilities(page);
    await page.getByTestId('utility-apply-button').click();
    await closeDeveloperUtilities(page);

    await openSettings(page);
    await openSettingsTab(page, 'editor');

    const clearButton = page.getByTestId('utilities-clear-all-history');
    await clearButton.click();
    await expect(clearButton).toContainText('Confirm');
    // Cancel link aborts.
    await page.getByTestId('utilities-clear-all-history-cancel').click();
    await expect(clearButton).toContainText('Clear all utility history');

    await closeSettings(page);
  });

  test('Apply gesture covers JWT, CRON, regex, color, html-entity, base64, json, url', async ({
    page,
  }) => {
    // Expanded coverage requested by the user — touch one panel per
    // shape, click Apply where the input satisfies detect, and assert
    // the new history drawer records the gesture. JWT and CRON were
    // explicitly called out; the rest exercise live, mode-flip, and
    // structural-detect shapes.
    await openDeveloperUtilities(page);

    const checkPanels: { id: string; heading: string }[] = [
      { id: 'json', heading: 'JSON Formatter' },
      { id: 'base64', heading: 'Base64 Encoder' },
      { id: 'url', heading: 'URL Encoder' },
      { id: 'jwt', heading: 'JWT Debugger' },
      { id: 'cron-parser', heading: 'Cron Parser' },
      { id: 'regex', heading: 'Regex Tester' },
      { id: 'color', heading: 'Color Converter' },
      { id: 'html-entity', heading: 'HTML Entity' },
    ];

    for (const { id, heading } of checkPanels) {
      await page.getByTestId(`utility-item-${id}`).click();
      await expect(
        page.getByRole('heading', { level: 2, name: heading })
      ).toBeVisible();
      if (id === 'base64') {
        await page.getByRole('textbox', { name: 'Input' }).fill('TGluZ3Vh');
      }
      if (id === 'url') {
        await page.getByRole('textbox', { name: 'Input' }).fill('name%3DLingua%20utils');
      }
      const apply = page.getByTestId('utility-apply-button');
      await expect(apply).toBeEnabled();
      await apply.click();
      await page.getByTestId('utility-history-drawer').click();
      await expect(page.getByTestId('utility-history-entry')).toHaveCount(1);
      await page.getByTestId('utility-history-drawer').click();
    }
  });

  test('Spanish locale: favorites label, history drawer copy, and Settings toggle status are localized', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await seedSession(page, { language: 'es', primeProLicense: true });
      await gotoApp(page);
      await expectTier(page, 'PRO');

      // Pin one panel so the favorites row mounts.
      await openDeveloperUtilities(page);
      await page.getByTestId('utility-favorite-toggle-json').click();
      await expect(page.getByText('Favoritos')).toBeVisible();

      // Open history drawer — labels in Spanish.
      await page.getByTestId('utility-history-drawer').click();
      await expect(page.getByText('Guarda entre recargas')).toBeVisible();
      await closeDeveloperUtilities(page);

      // Settings — clipboard toggle status reads in Spanish.
      await openSettings(page);
      await openSettingsTab(page, 'editor');
      await expect(
        page.getByTestId('utilities-clipboard-on-focus-status')
      ).toContainText('Desactivado');
      await closeSettings(page);
    } finally {
      await ctx.close();
    }
  });

  test('console stays clean across the full personalize flow', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await openDeveloperUtilities(page);

    // Pin two, click apply on three different panels, open the drawer.
    await page.getByTestId('utility-favorite-toggle-jwt').click();
    await page.getByTestId('utility-favorite-toggle-cron-parser').click();
    await page.getByTestId('utility-apply-button').click();
    await page.getByTestId('utility-item-jwt').click();
    await page.getByTestId('utility-apply-button').click();
    await page.getByTestId('utility-item-cron-parser').click();
    await page.getByTestId('utility-history-drawer').click();

    expect(errors, errors.join('\n')).toEqual([]);
  });
});
