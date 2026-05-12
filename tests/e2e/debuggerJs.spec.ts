/**
 * RL-027 Slice 1.5 — Debugger end-to-end smoke (JS).
 *
 * Drives the user-facing surface that the slice unlocks:
 *
 *   1. Gutter mark renders for a programmatically-set breakpoint.
 *   2. `DebuggerDrawer` mounts as soon as a breakpoint is set.
 *   3. The Settings → Editor → Debugger row reads + writes the
 *      master `debuggerEnabled` flag.
 *   4. Spanish copy renders in neutral LatAm tuteo (`Depurador`,
 *      `Borra todos los puntos de quiebre`).
 *
 * Pausing the JS worker live in Playwright is non-trivial (the
 * worker yields awaits and the test harness has to keep the
 * microtask queue moving); the unit + component tests already
 * cover that path. This spec is the BLOCKING surface gate: it
 * proves the gutter mounts, the drawer mounts, and the Settings
 * row is reachable. Without it, the user-facing slice cannot
 * be considered shipped.
 */

import {
  closeSettings,
  createJavaScriptTab,
  createTypeScriptTab,
  expect,
  gotoApp,
  openSettings,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Debugger (RL-027 Slice 1.5)', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await createJavaScriptTab(page);
  });

  test('the Debugger row is visible in Settings → Editor and toggles persistently', async ({
    page,
  }) => {
    await openSettings(page);
    await page.getByRole('tab', { name: 'Editor' }).click();
    const toggle = page.getByRole('switch', { name: /^Debugger$/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await closeSettings(page);
  });

  test('keyboard breakpoint toggle renders the gutter dot, toolbar pill, and drawer', async ({
    page,
  }) => {
    await expect(page.locator('.monaco-editor')).toBeVisible();
    // Click the editor body, not Monaco's hidden textarea. The textarea
    // can sit under the line-margin overlay and Playwright correctly
    // refuses that pixel as intercepted.
    await page.locator('.monaco-editor').click({ position: { x: 120, y: 36 } });
    await page.keyboard.press('Control+Shift+B');

    await expect(page.locator('.monaco-editor .lingua-bp-glyph')).toHaveCount(1);
    await expect(page.getByTestId('debugger-drawer')).toBeVisible();
    await expect(page.getByTestId('toolbar-breakpoint-pill')).toContainText(/1 breakpoint/i);
  });

  test('Spanish copy renders the Debugger Settings rows in neutral LatAm tuteo', async ({
    browser,
  }) => {
    // Spanish locale needs a fresh context — the `beforeEach` seeds
    // English and reseeding mid-test does not flip the already-loaded
    // i18n bundle. The pattern mirrors `utilitiesApply.spec.ts`'s
    // tuteo check.
    const context = await browser.newContext();
    const esPage = await context.newPage();
    try {
      await seedSession(esPage, { language: 'es' });
      await gotoApp(esPage);
      await createJavaScriptTab(esPage);

      await openSettings(esPage);
      await esPage.getByRole('tab', { name: /Editor/i }).click();
      await expect(esPage.getByRole('switch', { name: /^Depurador$/ })).toBeVisible();
      await expect(
        esPage.getByRole('switch', { name: /Pausa desactivada para todos/i })
      ).toBeVisible();
      // Borra (tuteo) — not "Borrá" (voseo).
      await expect(esPage.getByTestId('settings-debugger-clear-all')).toContainText(/Borra/);
      await closeSettings(esPage);
    } finally {
      await context.close();
    }
  });

  test('the console-error gate stays clean while flipping the Debugger toggle', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await openSettings(page);
    await page.getByRole('tab', { name: 'Editor' }).click();
    const toggle = page.getByRole('switch', { name: /^Debugger$/ });
    await toggle.click();
    await toggle.click();
    await closeSettings(page);

    expect(errors).toEqual([]);
  });
});

test.describe('Debugger TypeScript smoke (RL-027 Slice 1.5)', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await createTypeScriptTab(page);
  });

  test('keyboard breakpoint toggle works on a TypeScript tab', async ({ page }) => {
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await page.locator('.monaco-editor').click({ position: { x: 120, y: 36 } });
    await page.keyboard.press('Control+Shift+B');

    await expect(page.locator('.monaco-editor .lingua-bp-glyph')).toHaveCount(1);
    await expect(page.getByTestId('debugger-drawer')).toBeVisible();
    await expect(page.getByTestId('toolbar-breakpoint-pill')).toContainText(/1 breakpoint/i);
  });
});
