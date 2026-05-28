/**
 * RL-094 Slice 3 — keyboard contract for the capsule browse overlay.
 *
 * Acceptance: Mod+Alt+C opens the browse overlay; Escape closes it.
 * The default web session is Free, so the overlay renders the
 * Pro upsell variant — that observable cross-locale (EN + ES) contract
 * is what this spec locks. The Pro list + per-row actions are covered
 * by the component test suite.
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Capsule browse — Mod+Alt+C binding', () => {
  test('opens the overlay with the Free upsell (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+C');

    const dialog = page.getByRole('dialog', { name: /run capsules/i });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Browse run capsules with Pro/i)
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('localizes the overlay title in Spanish (tuteo)', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+C');

    const dialog = page.getByRole('dialog', {
      name: /cápsulas de ejecución/i,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Explora cápsulas con Pro/i)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
