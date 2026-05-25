/**
 * RL-024 Slice 2 — keyboard contract for project replace.
 *
 * Slice 2 acceptance: Cmd+Shift+H opens the "Replace in files" overlay
 * (the companion to Cmd+Shift+F find-in-files). We don't pick a real
 * project folder here because the web build's `showDirectoryPicker`
 * is a user-gesture-only API and can't be scripted in Playwright
 * without a Chrome flag dance. The full preview + apply happy path
 * is covered by the unit + component tests; this spec locks the
 * two observable e2e contracts:
 *
 *   1. Cmd+Shift+H opens the Project Replace overlay when no project
 *      is open — surfacing the "Open a project to use replace in files"
 *      empty state. This proves the binding lives.
 *   2. Esc closes the overlay.
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Project replace — Cmd+Shift+H binding', () => {
  test('opens the overlay with empty-state when no project is open', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+H');

    const dialog = page.getByRole('dialog', { name: /replace in files/i });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Open a project to use replace in files\./)
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('localizes the empty-state copy in Spanish', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+H');

    const dialog = page.getByRole('dialog', {
      name: /reemplaza en archivos/i,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Abre un proyecto para reemplazar/)
    ).toBeVisible();
  });
});
