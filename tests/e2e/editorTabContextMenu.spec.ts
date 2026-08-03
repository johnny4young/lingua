/**
 * Editor-tab context-menu activation boundary.
 *
 * The tab strip must remain immediately interactive while its portal actions
 * stay outside the initial graph until right-click or Shift+F10 requests them.
 */

import type { Page } from '@playwright/test';
import { dismissWhatsNew, expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

async function countContextMenuResources(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      performance
        .getEntriesByType('resource')
        .filter(entry => /\/assets\/EditorTabContextMenu-[^/]+\.js$/.test(entry.name)).length
  );
}

async function expectMenuInsideViewport(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  const bounds = await page.getByTestId('editor-tab-context-menu').boundingBox();
  expect(viewport).not.toBeNull();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(11);
  expect(bounds!.y).toBeGreaterThanOrEqual(11);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width - 11);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height - 11);
}

test('loads tab actions only after activation and reuses them across mouse and keyboard', async ({
  page,
}) => {
  await seedSession(page, { language: 'en' });
  await gotoApp(page);
  await dismissWhatsNew(page);

  const activeTab = page.locator('[data-testid="editor-tab-activation"][aria-current="page"]');
  const tab = activeTab.locator('..');
  await expect(activeTab).toBeVisible();
  expect(await countContextMenuResources(page)).toBe(0);

  await tab.click({ button: 'right', position: { x: 2, y: 2 } });
  const menu = page.getByTestId('editor-tab-context-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toContainText('Close');
  await expect(menu.getByRole('menuitem').filter({ hasText: 'Rename' })).toBeVisible();
  await expectMenuInsideViewport(page);
  expect(await countContextMenuResources(page)).toBe(1);

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await activeTab.focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  expect(await countContextMenuResources(page)).toBe(1);
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem').filter({ hasText: 'Close all' })).toBeFocused();
});
