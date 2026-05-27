/**
 * RL-100 Slice 1 — e2e for the global Import overlay.
 *
 * Acceptance: Mod+Alt+I opens the Import overlay from anywhere. EN
 * + ES locales render with tuteo copy. The full preview + confirm
 * flow is covered by the component test; the e2e pin focuses on
 * the keyboard binding + the locale-correct title.
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Import overlay — Mod+Alt+I binding (RL-100 Slice 1)', () => {
  test('opens via Mod+Alt+I (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+I');

    await expect(page.getByTestId('import-preview-overlay')).toBeVisible();
    await expect(page.getByText(/import data/i)).toBeVisible();
  });

  test('localizes the overlay in Spanish (tuteo)', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+I');

    await expect(page.getByTestId('import-preview-overlay')).toBeVisible();
    await expect(page.getByText(/importa datos/i)).toBeVisible();
  });
});
