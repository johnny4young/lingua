/**
 * RL-039 Slice B — e2e for the Recipes overlay.
 *
 * Acceptance: Mod+Alt+L opens the Recipes overlay from anywhere. EN
 * + ES locales render with tuteo copy. The full open + Run + Test
 * flow is pinned here because the assertion runner depends on real
 * worker message ordering.
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Recipes overlay — Mod+Alt+L binding (RL-039 Slice B)', () => {
  test('opens via Mod+Alt+L (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+L');

    await expect(page.getByTestId('recipes-overlay')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^recipes$/i })).toBeVisible();
  });

  test('localizes the overlay in Spanish (tuteo)', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+L');

    await expect(page.getByTestId('recipes-overlay')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^recetas$/i })).toBeVisible();
    await expect(page.getByTestId('recipes-cancel')).toHaveText(/cancelar/i);
  });

  test('opens a recipe and renders all Run + Test assertion results', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.getByRole('button', { name: /close welcome\.js/i }).click();
    await expect(page.getByRole('button', { name: /welcome\.js/i })).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+Alt+L');
    await page.getByTestId('recipes-search-input').fill('vowels');
    await page
      .getByTestId('recipes-list-row')
      .filter({ hasText: 'Count vowels in a string' })
      .click();

    await expect(page.getByTestId('recipe-run-panel')).toHaveAttribute(
      'data-recipe-id',
      'js-count-vowels'
    );
    await page.getByTestId('recipe-run-panel-run').click();

    await expect(page.getByTestId('recipe-run-panel-result-row')).toHaveCount(3);
    await expect(
      page.locator('[data-assertion-id="hello-world"]')
    ).toHaveAttribute('data-status', 'fail');
    await expect(
      page.locator('[data-assertion-id="case-insensitive"]')
    ).toHaveAttribute('data-status', 'fail');
    await expect(
      page.locator('[data-assertion-id="no-vowels"]')
    ).toHaveAttribute('data-status', 'pass');
  });
});
