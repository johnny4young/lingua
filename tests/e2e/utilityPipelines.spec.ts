/**
 * RL-099 Slice 1 — keyboard contract for the Utility Pipelines panel.
 *
 * Acceptance: Mod+Shift+G opens the Developer Utilities overlay with
 * the Pipelines panel preselected. EN + ES locales verify the
 * tuteo copy. The full run-flow + adapter behavior is covered by
 * the component + shared unit tests.
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Utility Pipelines — Mod+Shift+G binding', () => {
  test('opens the Pipelines panel inside Developer Utilities (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+G');

    await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();
    await expect(page.getByText(/no pipelines yet/i)).toBeVisible();
  });

  test('localizes the Pipelines panel in Spanish (tuteo)', async ({ page }) => {
    await seedSession(page, { language: 'es', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+G');

    await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();
    await expect(page.getByText(/aún no hay pipelines/i)).toBeVisible();
  });
});
