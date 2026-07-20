/**
 * implementation — keyboard contract for project search.
 *
 * implementation acceptance: Cmd+Shift+F searches across all open-folder
 * files. We don't actually pick a folder here (the web build's
 * `showDirectoryPicker` is a user-gesture-only API and can't be
 * scripted in Playwright without a Chrome flag dance); instead we
 * lock the two observable contracts:
 *
 *   1. Cmd+Shift+F opens the Project Search overlay when no project
 *      is open — surfacing the "Open a project to search" empty
 *      state. This proves the binding lives.
 *   2. Esc closes the overlay.
 *
 * The full happy path (matches against a real folder) lives in
 * `tests/stores/projectSearchStore.test.ts`; this spec covers the
 * keyboard + overlay layer the e2e harness can reach.
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Project search — Cmd+Shift+F binding', () => {
  test('opens the overlay with empty-state when no project is open', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    // The shortcut handler uses `Mod+Shift+F`; Playwright maps
    // `Meta` → Cmd on macOS and `Control` on Linux/Windows.
    // `ControlOrMeta` keeps the spec portable across CI runners.
    await page.keyboard.press('ControlOrMeta+Shift+F');

    const dialog = page.getByRole('dialog', { name: /search in files/i });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Open a project to search across its files\./)
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('localizes the empty-state copy in Spanish', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+F');

    const dialog = page.getByRole('dialog', { name: /buscar en archivos/i });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Abre un proyecto para buscar/)
    ).toBeVisible();
  });
});
