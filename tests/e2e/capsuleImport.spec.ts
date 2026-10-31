/**
 * Keyboard contract for the capsule import overlay.
 *
 * Acceptance: Mod+Shift+Y opens the import overlay; Escape closes it.
 * The full decode + open-tab flow is covered by the component test
 * suite. This spec locks the cross-locale (EN + ES) observable e2e
 * contract: shortcut + role/dialog + close.
 */

import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';
import { expect, gotoApp, openConsole, seedSession, test } from './licenseWeb.helpers';

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
      name: /importar una cápsula/i,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Sin cápsula cargada todavía/i)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('an opened capsule waits for Run instead of running on its own (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    const capsule = { ...FIXTURE_MINIMAL_JS, source: { ...FIXTURE_MINIMAL_JS.source, content: "console.log('capsule-ran-by-itself');" } };

    await page.keyboard.press('ControlOrMeta+Shift+Y');
    await page.getByTestId('capsule-import-paste-textarea').fill(JSON.stringify(capsule));
    await page.getByTestId('capsule-import-overlay-confirm').click();
    await expect(page.getByTestId('editor-tab-filename').filter({ hasText: 'scratchpad.js' })).toBeVisible();

    // Scratchpad would auto-run the new tab after its 1.2 s debounce.
    await openConsole(page);
    await page.waitForTimeout(2500);
    await expect(page.getByTestId('console-entry-row').filter({ hasText: 'capsule-ran-by-itself' })).toHaveCount(0);
    await expect(page.getByTestId('action-pill-run')).toHaveAttribute('data-running', 'false');
  });
});
