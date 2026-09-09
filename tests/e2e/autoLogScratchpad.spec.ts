/**
 * implementation — bare-expression auto-log end-to-end smoke.
 *
 * Locks the user-visible contract:
 *
 *   - With auto-log enabled for Scratchpad worker languages via `localStorage`,
 *     bare expressions on their own line surface a
 *     `data-result-kind="autoLog"` row.
 *   - Magic-comment arrow precedence is preserved: a line with `//=>`
 *     stays `data-result-kind="magic"`, not auto-log.
 *   - The auto-log status pill renders when the gate resolves to true.
 *
 * Monaco gesture pattern matches `magicWatch.spec.ts`: click the
 * editor body, then keyboard-replace the buffer wholesale.
 */

import type { Page } from '@playwright/test';
import {
  createJavaScriptTab,
  createLanguageTab,
  dismissWhatsNew,
  expect,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';

declare global {
  interface Window {
    __linguaE2e?: {
      pythonRuntimeBooted?: () => Promise<boolean>;
      autoRunSettled?: () => boolean;
    };
  }
}

async function replaceEditorText(page: Page, source: string): Promise<void> {
  await page
    .locator('.monaco-editor')
    .first()
    .click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
  );
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(source);
}

/**
 * Seed the auto-log Settings flag for the next page navigation via an
 * init script (runs BEFORE the renderer loads, same shape as
 * `seedSession`). Reads any existing `lingua-settings` payload and
 * merges in the JS / TS / Python `scratchpadAutoLogByLanguage` defaults so
 * the settings store rehydrate path sees the field on first load.
 */
async function enableAutoLogForScratchpadLanguages(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const settingsKey = 'lingua-settings';
    const raw = window.localStorage.getItem(settingsKey);
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = parsed.state ?? {};
    parsed.state.scratchpadAutoLogByLanguage = {
      javascript: true,
      typescript: true,
      python: true,
    };
    window.localStorage.setItem(settingsKey, JSON.stringify(parsed));
  });
}

test.describe('expression auto-log ', () => {
  test('surfaces autoLog rows for bare expressions in a JS Scratchpad tab', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await enableAutoLogForScratchpadLanguages(page);
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await replaceEditorText(
      page,
      'const x = 5;\nconst y = 10;\nx + y\nx * y\n'
    );

    // rows.first() toBeVisible below is the sync point for the
    // debounced auto-run; no fixed wait needed.
    const rows = page.locator('[data-result-kind="autoLog"]');
    await expect(rows.first()).toBeVisible();
    // Two bare expressions → two auto-log rows surfaced.
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('15');
    await expect(rows.nth(1)).toContainText('50');
  });

  test('preserves magic-arrow precedence on a shared line', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await enableAutoLogForScratchpadLanguages(page);
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await replaceEditorText(
      page,
      'const z = 21 * 2;\nz //=> answer\n'
    );
    await page.waitForTimeout(1_400);

    // The arrow line emits as `magic`, not `autoLog`.
    await expect(
      page.locator('[data-result-kind="autoLog"]')
    ).toHaveCount(0);
    await expect(
      page.locator('text=42').first()
    ).toBeVisible();
  });

  test('AutoLog status pill mirrors the resolved gate', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await enableAutoLogForScratchpadLanguages(page);
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await replaceEditorText(page, 'const x = 5;\nx + 1\n');

    await expect(
      page.locator('[data-result-kind="autoLog-pill"]')
    ).toBeVisible();
  });

  test('surfaces TypeScript values and Error objects on their source lines', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await enableAutoLogForScratchpadLanguages(page);
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createLanguageTab(page, /^TypeScript\b/i, /TS .*\.ts/i);

    await replaceEditorText(
      page,
      [
        'eval(`throw new Error("device id must be numeric: dd")`);',
        "Number('42');",
      ].join('\n')
    );

    const errorRow = page.locator('[data-result-kind="error"]');
    await expect(errorRow).toBeVisible();
    await expect(errorRow).toContainText('device id must be numeric: dd');
    await expect(errorRow.locator('[data-type-pill="error"]')).toBeVisible();
    const valueRows = page.locator('[data-result-kind="autoLog"]');
    await expect(valueRows).toHaveCount(1);
    await expect(valueRows).toContainText('42');
  });

  test('uses CPython AST auto-log for top-level Python expressions', async ({ page }) => {
    // Sized from the stages below, not guessed: 100s boot + 60s run +
    // the 30s CI expect budget = 190s, plus setup. A ceiling under that
    // sum would cut off the very stage it exists to accommodate.
    test.setTimeout(210_000);
    await seedSession(page, { language: 'es' });
    await enableAutoLogForScratchpadLanguages(page);
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createLanguageTab(page, /^Python\b/i, /PY .*\.py/i);

    await replaceEditorText(
      page,
      [
        'int("dd")',
        'int("42")',
        '1 + 1',
      ].join('\n')
    );

    // The debounced auto-run above is what triggers the Pyodide boot — the
    // contract this test locks. Three stages, each waiting on the signal that
    // actually governs it, so a slow phase never reads as a missing result.
    //
    // 1. Boot, on the app's own budget: the runner allows PYODIDE_LOAD_TIMEOUT
    //    (90s), so a single 75s wait on the result row undercut it and flaked.
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.__linguaE2e?.pythonRuntimeBooted?.() ?? false
          ),
        { timeout: 100_000, intervals: [1_000] }
      )
      .toBe(true);

    // 2. Run completion. Booted is not finished: the first execution after a
    //    cold boot still initialises the worker and runs the CPython auto-log
    //    pass, and on a loaded runner that overran the 15s the row assertion
    //    used to allow. Polling the settle flag makes a slow run wait and a
    //    genuinely empty run fail here, with the reason on the tin.
    await expect
      .poll(
        () =>
          page.evaluate(() => window.__linguaE2e?.autoRunSettled?.() ?? false),
        { timeout: 60_000, intervals: [500] }
      )
      .toBe(true);

    // 3. The rows themselves, on the project's own expect budget (30s on CI,
    //    playwright.license-web.config.mts). The old explicit 15s here was
    //    not just short, it OVERRODE that budget downward. By now the run has
    //    published, so anything missing is a real regression.
    const errorRow = page.locator('[data-result-kind="error"]');
    await expect(errorRow).toBeVisible();
    await expect(errorRow).toContainText('invalid literal for int()');
    const valueRows = page.locator('[data-result-kind="autoLog"]');
    await expect(valueRows).toHaveCount(2);
    await expect(valueRows.nth(0)).toContainText('42');
    await expect(valueRows.nth(1)).toContainText('2');
  });
});
