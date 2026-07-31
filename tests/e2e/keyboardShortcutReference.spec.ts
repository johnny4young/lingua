/**
 * Keyboard shortcut reference metadata activation boundary.
 *
 * Global dispatch, persisted override sanitization, and compact shortcut hints
 * need the structural catalog at startup. Localized labels, descriptions,
 * groups, and search keywords should arrive only with the lazy Settings tree.
 */

import type { Page } from '@playwright/test';
import {
  expect,
  gotoApp,
  openSettings,
  openSettingsTab,
  seedSession,
  test,
} from './licenseWeb.helpers';

async function countReferenceResources(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      performance
        .getEntriesByType('resource')
        .filter(entry => /\/assets\/keyboardShortcutReference-[^/]+\.js$/u.test(entry.name))
        .length
  );
}

test('loads shortcut reference metadata with Settings and reuses it in the editor', async ({
  page,
}) => {
  await seedSession(page, { language: 'en' });
  await gotoApp(page);

  expect(await countReferenceResources(page)).toBe(0);

  await openSettings(page);
  await expect.poll(() => countReferenceResources(page)).toBe(1);
  await openSettingsTab(page, 'shortcuts');
  await expect(page.getByText('Run or stop the active tab', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Open shortcuts list' }).click();
  const modal = page.getByTestId('keyboard-shortcuts-modal');
  await expect(modal).toBeVisible();
  await modal.getByRole('searchbox', { name: 'Search shortcuts' }).fill('fuzzy');
  await expect(modal.getByText('Quick Open', { exact: true })).toBeVisible();

  expect(await countReferenceResources(page)).toBe(1);
});
