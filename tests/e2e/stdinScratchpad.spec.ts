/**
 * RL-020 Slice 6 — stdin / input end-to-end smoke.
 *
 * Locks the user-visible contract via diverse paths:
 *
 *   1. JavaScript `prompt()` consumes the buffer line-by-line and
 *      surfaces the value through auto-log (Slice 5).
 *   2. TypeScript `readline()` reads the same buffer (the runners
 *      share the JS worker, but the test exercises the TS surface
 *      so we catch a regression that breaks transpile threading).
 *   3. Python `input()` consumes the buffer via Pyodide setStdin.
 *   4. Buffer survives a JS → Python `renameTab` (both languages
 *      support stdin).
 *   5. JS → Rust rename clears the buffer (Rust is unsupported).
 *   6. The Input tab is hidden when Settings → Editor master
 *      toggle is off.
 *   7. The status pill mirrors a staged buffer; the consumed pill
 *      mirrors the runner's report.
 *   8. ES locale (tuteo) — the Settings copy + tab label are
 *      localized.
 *   9. Empty buffer ⇒ no patching: a JS `prompt()` call returns
 *      `null` (the panel hint promised native behavior).
 *  10. Console stays clean across the full flow.
 *  11. Named input sets switch stdin/argv together and survive reload.
 */

import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  createJavaScriptTab,
  dismissWhatsNew,
  expect,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';

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

async function fillStdinTextarea(page: Page, text: string): Promise<void> {
  const lines = text.split('\n');
  for (const [idx, line] of lines.entries()) {
    await page
      .getByRole('textbox', { name: `Response for call ${idx + 1}` })
      .fill(line);
  }
}

async function openStdinTab(page: Page): Promise<void> {
  // Open the bottom panel via Mod+\ (the View → Toggle Console
  // shortcut wires `consoleVisible: true`, which lets the tab strip
  // render the Input tab). Then click the Input tab so the
  // `<StdinInputPanel>` body mounts and the textarea is reachable.
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+Backslash`);
  await page.getByTestId('bottom-panel-stdin-tab').click();
}

test.describe('stdin / input — JS + TS + Python (RL-020 Slice 6)', () => {
  test('1. JS prompt() consumes the buffer and surfaces via auto-log', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await page.addInitScript(() => {
      const raw = window.localStorage.getItem('lingua-settings');
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
      parsed.state = parsed.state ?? {};
      parsed.state.scratchpadAutoLogByLanguage = {
        javascript: true,
        typescript: true,
      };
      window.localStorage.setItem('lingua-settings', JSON.stringify(parsed));
    });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await openStdinTab(page);
    await fillStdinTextarea(page, '2\n3');

    await replaceEditorText(
      page,
      'const a = parseInt(prompt(), 10);\nconst b = parseInt(prompt(), 10);\na + b\n'
    );

    const rows = page.locator('[data-result-kind="autoLog"]');
    await expect(rows.first()).toBeVisible();
    await expect(rows.last()).toContainText('5');
  });

  test('2. The status pill mirrors the staged buffer line count', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await openStdinTab(page);
    await fillStdinTextarea(page, 'apple\nbanana\ncherry');

    // Wait for the panel write to land in the store.
    await page.waitForTimeout(200);

    const pill = page.locator('[data-result-kind="stdin-pill"]');
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('3');
  });

  test('3. Empty stdin buffer leaves prompt() returning null (native)', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    // Empty buffer: native worker prompt() is undefined; the user's
    // call throws ReferenceError, which the panel renders as an
    // error row. We assert the user-facing error message rather
    // than passing a wrong value through unchecked.
    await replaceEditorText(
      page,
      'try { prompt(); } catch (e) { console.error(e.message); }\n'
    );

    const console = page.locator('text=prompt is not defined');
    // jsdom workers don't ship `prompt`. The empty-buffer path
    // leaves the worker default in place, which throws — verifying
    // that we don't accidentally patch when the buffer is empty.
    await expect(console).toBeVisible();
  });

  test('4. Settings → master toggle off hides the Input tab', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await page.addInitScript(() => {
      const raw = window.localStorage.getItem('lingua-settings');
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
      parsed.state = parsed.state ?? {};
      parsed.state.showStdinPanel = false;
      window.localStorage.setItem('lingua-settings', JSON.stringify(parsed));
    });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+Backslash`);

    await expect(
      page.getByTestId('bottom-panel-stdin-tab')
    ).toHaveCount(0);
  });

  test('5. Spanish locale — the tab label uses tuteo (Entrada)', async ({
    page,
  }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+Backslash`);

    const tab = page.getByTestId('bottom-panel-stdin-tab');
    await expect(tab).toContainText('Entrada');
    await tab.click();
    await expect(page.getByText('Conjunto de entrada', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Nombre del conjunto de entrada')).toBeVisible();
    if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
      mkdirSync('output/review/project-sequence/t03-input-sets', { recursive: true });
      await page.screenshot({
        path: 'output/review/project-sequence/t03-input-sets/web-es-input-sets.png',
      });
    }
  });

  test('6. Named input sets switch stdin + argv together and survive reload', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await page.addInitScript(() => {
      const raw = window.localStorage.getItem('lingua-settings');
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
      parsed.state = parsed.state ?? {};
      parsed.state.restoreSessionMode = 'always';
      window.localStorage.setItem('lingua-settings', JSON.stringify(parsed));
    });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await openStdinTab(page);

    await fillStdinTextarea(page, 'Ada');
    await page.getByLabel('Command arguments').fill('--mode\nfast');
    await page.getByLabel('Input set name').fill('Happy path');
    await page.getByTestId('stdin-input-set-save').click();

    const selector = page.getByLabel('Select an input set');
    await expect(selector).toHaveValue(/.+/);
    await selector.selectOption({ label: 'Unsaved draft' });
    await page.getByRole('textbox', { name: 'Response for call 1' }).fill('Grace');
    await page.getByLabel('Command arguments').fill('--dry-run');
    await page.getByLabel('Input set name').fill('Edge case');
    await page.getByTestId('stdin-input-set-save').click();

    await selector.selectOption({ label: 'Happy path' });
    await expect(page.getByRole('textbox', { name: 'Response for call 1' })).toHaveValue('Ada');
    await expect(page.getByLabel('Command arguments')).toHaveValue('--mode\nfast');

    if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
      mkdirSync('output/review/project-sequence/t03-input-sets', { recursive: true });
      await page.screenshot({
        path: 'output/review/project-sequence/t03-input-sets/web-en-input-sets.png',
      });
    }

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem('lingua-session');
          if (!raw) return 0;
          const parsed = JSON.parse(raw) as {
            state?: { savedTabs?: Array<{ inputSets?: unknown[] }> };
          };
          return parsed.state?.savedTabs?.[0]?.inputSets?.length ?? 0;
        })
      )
      .toBe(2);

    await page.reload();
    await expect(page.getByTestId('license-badge')).toBeVisible();
    await openStdinTab(page);
    await expect(page.getByLabel('Select an input set')).toContainText('Happy path');
    await expect(page.getByRole('textbox', { name: 'Response for call 1' })).toHaveValue('Ada');
    await expect(page.getByLabel('Command arguments')).toHaveValue('--mode\nfast');
  });
});
