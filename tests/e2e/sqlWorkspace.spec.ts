/**
 * RL-097 Slice 2 — keyboard + tab contract for the SQL workspace.
 *
 * Acceptance: Mod+Alt+S opens the bottom-panel SQL tab; the panel
 * renders the empty state until a query is created. The full
 * run/result flow is covered by the component test suite with a
 * mocked DuckDB engine. This spec locks the cross-locale (EN + ES)
 * observable e2e contract: shortcut + tab visibility + empty state.
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('SQL workspace — Mod+Alt+S binding', () => {
  test('opens the SQL workspace bottom-panel tab (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+S');

    // Tab button + panel surface render.
    await expect(page.getByTestId('bottom-panel-sql-tab')).toBeVisible();
    await expect(page.getByTestId('sql-workspace-panel')).toBeVisible();

    // Empty state copy on the editor slot until a query is created.
    await expect(
      page.getByText(/No query selected/i)
    ).toBeVisible();
  });

  test('localizes the SQL workspace tab in Spanish (tuteo)', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+S');

    await expect(page.getByTestId('bottom-panel-sql-tab')).toBeVisible();
    await expect(page.getByTestId('sql-workspace-panel')).toBeVisible();

    await expect(
      page.getByText(/Sin consulta seleccionada/i)
    ).toBeVisible();
  });
});
