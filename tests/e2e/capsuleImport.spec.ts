/**
 * implementation — keyboard contract for the capsule import overlay.
 *
 * Acceptance: Mod+Shift+Y opens the import overlay; Escape closes it.
 * The full decode + open-tab flow is covered by the component test
 * suite. This spec locks the cross-locale (EN + ES) observable e2e
 * contract: shortcut + role/dialog + close.
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Capsule import — Mod+Shift+Y binding', () => {
  test('opens the overlay with empty state (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+Y');

    const dialog = page.getByRole('dialog', { name: /import a capsule/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/No capsule loaded yet/i)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('localizes the overlay title in Spanish (tuteo)', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+Y');

    const dialog = page.getByRole('dialog', {
      name: /importa una cápsula/i,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Sin cápsula cargada todavía/i)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
