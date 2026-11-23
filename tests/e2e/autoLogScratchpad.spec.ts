/**
 * bare-expression auto-log end-to-end smoke.
 *
 * Locks the user-visible contract:
 *
 *   - With auto-log enabled for Scratchpad worker languages via `localStorage`,
 *     bare expressions and top-level assignments on their own line surface a
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
 * Type a buffer line by line, replacing Monaco's auto-indent with each line's
 * own indentation so Python blocks land exactly as written.
 */
async function typeEditorLines(page: Page, source: string): Promise<void> {
  await replaceEditorText(page, '');
  for (const [index, line] of source.split('\n').entries()) {
    if (index > 0) {
      await page.keyboard.insertText('\n');
      await page.keyboard.press('Shift+Home');
      await page.keyboard.press('Delete');
    }
    if (line) await page.keyboard.insertText(line);
  }
}

const LATENCIES_PY = [
  'from statistics import mean, quantiles',
  'from random import gauss',
  'from time import sleep',
  '',
  'api    = [38, 41, 35, 44, 39, 52, 37]',
  'worker = [12, 14, 11, 13, 19, 12, 11]',
  'db     = [92, 88, 97, 131, 90, 86, 94]',
  'latencies = {"api": api, "worker": worker, "db": db}',
  'palette = {"api": "#7FD8C4", "worker": "#C8A6FF", "db": "#FF7566"}',
  '',
  'averages = {n: round(mean(s), 1) for n, s in latencies.items()}',
  'p95 = {n: round(quantiles(s, n=20)[-1], 1) for n, s in latencies.items()}',
  '',
  'report = [',
  '    {"service": n, "avg": averages[n], "p95": p95[n], "ok": p95[n] < 120}',
  '    for n in latencies',
  ']',
  '',
  'slowest = max(averages, key=averages.get)',
  'budget = 120 - p95[slowest]',
  '',
  'for name in latencies:',
  '    live = [gauss(averages[name], 4) for _ in range(50)]',
  '    print(f"{name:<7} {mean(live):5.1f} ms")',
  '',
  'print(f"slowest path: {slowest}")',
].join('\n');

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
    // Two declarations and two bare expressions, each on its own line.
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(2)).toContainText('15');
    await expect(rows.nth(3)).toContainText('50');
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

    // The arrow line emits as `magic`; only the declaration above it auto-logs.
    const line = (n: number) => page.locator(`[data-testid="lingua-inline-result"][data-line="${n}"]`);
    await expect(line(2).locator('[data-result-kind="magic"]')).toContainText('42');
    await expect(line(2).locator('[data-result-kind="autoLog"]')).toHaveCount(0);
    await expect(line(1).locator('[data-result-kind="autoLog"]')).toContainText('42');
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
    await expect(errorRow.locator('[data-testid="answer-object"][data-kind="error"]')).toBeVisible();
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

    // Auto-run is what triggers the Pyodide boot — the contract this test
    // locks. On a loaded host the new tab's seeded code can start that boot
    // before the replacement text lands, so the edit's run reaches the runner
    // mid-boot; the runner lets only that newer run reach the worker. Three
    // stages, each waiting on the signal that actually governs it, so a slow
    // phase never reads as a missing result.
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

  test('answers top-level JS declarations, multi-line ones on their first line', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await enableAutoLogForScratchpadLanguages(page);
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await replaceEditorText(
      page,
      [
        'const double = (n) => n * 2;',
        'const api = [38, 41, 35];',
        'const report = api.map((ms) => ({',
        '  ms,',
        '}));',
        'const { length } = api;',
        'let slowest;',
        'slowest = Math.max(...api)',
      ].join('\n')
    );

    const line = (n: number) => page.locator(`[data-testid="lingua-inline-result"][data-line="${n}"]`);
    await expect(line(2).locator('[data-result-kind="autoLog"]')).toContainText('array·3');
    await expect(line(3).locator('[data-testid="answer-picture-table"]')).toBeVisible();
    await expect(line(8).locator('[data-result-kind="autoLog"]')).toContainText('41');
    // Arrow values, destructuring and declarations without a value stay quiet.
    for (const quiet of [1, 6, 7]) await expect(line(quiet)).toHaveCount(0);
  });

  test('answers every top-level assignment of the Python latencies file', async ({ page }) => {
    // Same staged budget as the CPython auto-log test: boot, run, then rows.
    test.setTimeout(210_000);
    await seedSession(page, { language: 'en' });
    await enableAutoLogForScratchpadLanguages(page);
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createLanguageTab(page, /^Python\b/i, /PY .*\.py/i);
    await typeEditorLines(page, LATENCIES_PY);

    await expect
      .poll(() => page.evaluate(() => window.__linguaE2e?.pythonRuntimeBooted?.() ?? false), {
        timeout: 100_000,
        intervals: [1_000],
      })
      .toBe(true);
    const line = (n: number) => page.locator(`[data-testid="lingua-inline-result"][data-line="${n}"]`);
    await expect(line(20)).toBeAttached({ timeout: 60_000 });
    // Typing left the editor scrolled to the end; bring the top lines into view.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');

    await expect(line(5)).toContainText('list·7');
    await expect(line(5).locator('[data-testid="answer-picture-bars"]')).toBeVisible();
    await expect(line(8)).toContainText('dict·3');
    await expect(line(8).locator('[data-testid="answer-picture-keys"]')).toBeVisible();
    await expect(line(9).locator('[data-testid="answer-picture-colours"]')).toContainText('#C8A6FF');
    await expect(line(14).locator('[data-testid="answer-picture-table"]')).toBeVisible();
    await expect(line(20).locator('[data-testid="answer-picture-gauge"]')).toBeVisible();
    // The loop body is not module level, and print lines keep their stdout answer.
    await expect(line(23)).toHaveCount(0);
    await expect(line(26).locator('[data-result-kind="log"]')).toContainText('slowest path: db');
    // Colour answers replace Monaco's inline swatches, so each colour shows once.
    await expect(page.locator('.monaco-editor .colorpicker-color-decoration')).toHaveCount(0);
  });
});

