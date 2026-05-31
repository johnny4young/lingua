/**
 * RL-097 Slice 2 → MOV.02 (FASE 3) — keyboard + tab contract for the
 * SQL workspace.
 *
 * The SQL workspace left the bottom dock to become a full-screen
 * `FileTab`. Acceptance now: Mod+Alt+S opens (or focuses) a SQL
 * workspace tab in the editor tab strip; the full-screen panel
 * renders in the editor area; the tab carries the SQL kind glyph and
 * the workspace-level "SQL" label. Query CRUD/run/result flow is
 * covered by the component test suite with a mocked DuckDB engine.
 * This spec locks the cross-locale (EN + ES) observable e2e contract:
 * shortcut → editor tab + full-screen panel.
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('SQL workspace — Mod+Alt+S binding', () => {
  test('opens the SQL workspace as a full-screen tab (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+S');

    // A SQL workspace tab appears in the editor tab strip (kind glyph)
    // and the full-screen panel renders in the editor area.
    await expect(
      page.locator('[data-testid="editor-tab-kind-glyph"][data-tab-kind="sql"]')
    ).toBeVisible();
    await expect(page.getByTestId('sql-workspace-panel')).toBeVisible();

    // Opening the workspace does not create a query implicitly; the tab
    // names the stable workspace and the panel offers the create CTA.
    await expect(
      page.getByTestId('editor-tab-filename').filter({ hasText: 'SQL' })
    ).toBeVisible();
    await expect(page.getByTestId('sql-workspace-empty')).toBeVisible();
  });

  test('opens the SQL workspace as a full-screen tab (ES)', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+S');

    await expect(
      page.locator('[data-testid="editor-tab-kind-glyph"][data-tab-kind="sql"]')
    ).toBeVisible();
    await expect(page.getByTestId('sql-workspace-panel')).toBeVisible();
  });
});
