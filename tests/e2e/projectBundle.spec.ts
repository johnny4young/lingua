/**
 * RL-024 Slice 3 — e2e for the project bundle import overlay.
 *
 * Acceptance: the "Import project from zip" command-palette action
 * opens the bundle import overlay, in EN + ES (tuteo) locales. The
 * full preview + extract flow is desktop-only (web surfaces
 * `projectBundle.web.unsupported`) and is covered by the component +
 * IPC tests; this pin focuses on the palette wiring + locale copy.
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

function paletteInput(page: import('@playwright/test').Page) {
  return page.getByRole('dialog').getByRole('textbox').first();
}

test.describe('Project bundle import overlay (RL-024 Slice 3)', () => {
  test('opens from the command palette (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+KeyP');
    await expect(paletteInput(page)).toBeVisible();
    await paletteInput(page).fill('Import project from zip');
    await page
      .locator('[data-result-index]')
      .filter({ hasText: /Import project from zip/i })
      .first()
      .click();

    await expect(page.getByTestId('project-bundle-import-overlay')).toBeVisible();
    await expect(page.getByText(/import project bundle/i)).toBeVisible();
  });

  test('localizes the overlay in Spanish (tuteo)', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+KeyP');
    await expect(paletteInput(page)).toBeVisible();
    await paletteInput(page).fill('Importa un proyecto desde zip');
    await page
      .locator('[data-result-index]')
      .filter({ hasText: /Importa un proyecto desde zip/i })
      .first()
      .click();

    await expect(page.getByTestId('project-bundle-import-overlay')).toBeVisible();
    await expect(page.getByText('Importa un bundle de proyecto')).toBeVisible();
  });
});
