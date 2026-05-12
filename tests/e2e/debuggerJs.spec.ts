import type { Page } from '@playwright/test';

/**
 * RL-027 Slice 1.5 — Debugger end-to-end smoke (JS).
 *
 * Drives the user-facing surface that the slice unlocks:
 *
 *   1. Gutter mark renders for a programmatically-set breakpoint.
 *   2. Breakpoint state stays in the bottom-panel Debugger tab,
 *      without stealing the output panel by default.
 *   3. The Settings → Editor → Debugger row reads + writes the
 *      master `debuggerEnabled` flag.
 *   4. Spanish copy renders breakpoint actions in the Debugger panel,
 *      not in Settings.
 *
 * Pausing the JS worker live in Playwright is non-trivial (the
 * worker yields awaits and the test harness has to keep the
 * microtask queue moving); the unit + component tests already
 * cover that path. This spec is the BLOCKING surface gate: it
 * proves the gutter mounts, the bottom-panel Debugger tab mounts, and the Settings
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
  waitForRunCompleted,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

async function replaceEditorText(page: Page, source: string) {
  await page.locator('.monaco-editor').click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(source);
}

async function moveEditorCursorToLine(page: Page, line: number) {
  await page.locator('.monaco-editor').click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.press('Home');
  for (let index = 1; index < line; index += 1) {
    await page.keyboard.press('ArrowDown');
  }
}

async function openRunMenu(page: Page) {
  await page.getByTestId('toolbar-run-menu-button').click();
}

async function clickDebug(page: Page) {
  await openRunMenu(page);
  await page.getByTestId('toolbar-debug-button').click();
}

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

  test('keyboard breakpoint toggle renders the gutter dot and debugger tab state', async ({
    page,
  }) => {
    await expect(page.locator('.monaco-editor')).toBeVisible();
    // Click the editor body, not Monaco's hidden textarea. The textarea
    // can sit under the line-margin overlay and Playwright correctly
    // refuses that pixel as intercepted.
    await page.locator('.monaco-editor').click({ position: { x: 120, y: 36 } });
    await page.keyboard.press('Control+Shift+B');

    await expect(page.locator('.monaco-editor .lingua-bp-glyph')).toHaveCount(1);
    await expect(page.getByTestId('debugger-drawer')).toHaveCount(0);
    await expect(page.getByTestId('toolbar-breakpoint-pill')).toHaveCount(0);

    await page.getByRole('button', { name: /toggle console/i }).click();
    await expect(page.getByTestId('bottom-panel-debugger-tab')).toBeVisible();
    await expect(page.getByTestId('bottom-panel-debugger-count')).toContainText('1');
    await page.getByTestId('bottom-panel-debugger-tab').click();
    await expect(page.getByTestId('debugger-drawer')).toBeVisible();
    await expect(page.getByTestId('debugger-breakpoint-summary')).toContainText('1/1');

    await openRunMenu(page);
    await expect(page.getByTestId('toolbar-debug-button')).toBeEnabled();
  });

  test('Run ignores breakpoints while Debug pauses, highlights the line, and steps over', async ({
    page,
  }) => {
    await replaceEditorText(
      page,
      [
        'const value = 21;',
        'const doubled = value * 2;',
        'const label = `value:${doubled}`;',
        'console.log(label);',
      ].join('\n')
    );
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Control+Shift+B');

    await expect(page.locator('.monaco-editor .lingua-bp-glyph')).toHaveCount(1);

    await page.getByTestId('toolbar-run-button').click();
    await waitForRunCompleted(page);
    await expect(page.locator('.monaco-editor .lingua-debugger-paused-line')).toHaveCount(0);

    await clickDebug(page);
    await expect(page.getByText(/Paused at line 3/i)).toBeVisible();
    await expect(page.locator('.monaco-editor .lingua-debugger-paused-line')).toHaveCount(1);
    await expect(page.getByTestId('debugger-locals')).toContainText('value: 21');
    await expect(page.getByTestId('debugger-locals')).toContainText('doubled: 42');

    await page.getByTestId('debugger-step-over').click();
    await expect(page.getByText(/Paused at line 4/i)).toBeVisible();
    await expect(page.getByTestId('debugger-locals')).toContainText('label: value:42');

    await page.getByTestId('debugger-continue').click();
    await waitForRunCompleted(page);
    await expect(page.locator('.monaco-editor .lingua-debugger-paused-line')).toHaveCount(0);
  });

  test('Debug streams prior logs while paused and resumes with the remaining output', async ({
    page,
  }) => {
    await replaceEditorText(
      page,
      [
        '// Welcome to Lingua',
        'console.log("Hello, World!");',
        '',
        'i = "1";',
        '',
        'console.log(i + 1);',
      ].join('\n')
    );
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Control+Shift+B');

    await clickDebug(page);
    await expect(page.getByText(/Paused at line 4/i)).toBeVisible();
    const resultsPanel = page.locator('#results-panel');
    await expect(resultsPanel.getByText('Hello, World!')).toBeVisible();
    await expect(page.getByTestId('debugger-locals')).toContainText(
      'No variables are available before this line.'
    );
    await expect(page.getByText(/time limit of 30 s/i)).toHaveCount(0);

    await page.getByTestId('debugger-step-over').click();
    await expect(page.getByText(/Paused at line 6/i)).toBeVisible();
    await expect(page.getByTestId('debugger-locals')).toContainText('i: 1');

    await page.getByTestId('debugger-continue').click();
    await waitForRunCompleted(page);
    await expect(resultsPanel.getByText('Hello, World!')).toBeVisible();
    await expect(resultsPanel.getByText(/^11$/)).toBeVisible();
    await expect(page.getByText(/time limit of 30 s/i)).toHaveCount(0);
  });

  test('Step Into enters a normal function and Step Out is only active inside it', async ({
    page,
  }) => {
    await replaceEditorText(
      page,
      [
        '// Welcome to Lingua',
        'console.log("Hello, World!");',
        '',
        'let i = 1',
        '',
        'console.log( i + 20)',
        '',
        '',
        'console.log(i +5)',
        '',
        'llamar(i);',
        '',
        '',
        'function llamar(i){',
        '  console.log(i + "calling")',
        '}',
      ].join('\n')
    );

    await moveEditorCursorToLine(page, 11);
    await page.keyboard.press('Control+Shift+B');

    await clickDebug(page);
    await expect(page.getByText(/Paused at line 11/i)).toBeVisible();
    await expect(page.getByTestId('debugger-step-out')).toBeDisabled();
    const resultsPanel = page.locator('#results-panel');
    await expect(resultsPanel.getByText('Hello, World!')).toBeVisible();
    await expect(resultsPanel.getByText(/^21$/)).toBeVisible();
    await expect(resultsPanel.getByText(/^6$/)).toBeVisible();

    await page.getByTestId('debugger-step-into').click();
    await expect(page.getByText(/Paused at line 15/i)).toBeVisible();
    await expect(page.getByTestId('debugger-callstack')).toContainText('llamar');
    await expect(page.getByTestId('debugger-step-out')).toBeEnabled();
    await expect(page.getByTestId('debugger-locals')).toContainText('i: 1');

    await page.getByTestId('debugger-step-out').click();
    await waitForRunCompleted(page);
    await expect(resultsPanel.getByText('1calling')).toBeVisible();
  });

  test('Spanish copy keeps breakpoint actions in the Debugger panel', async ({
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
      ).toHaveCount(0);
      await expect(esPage.getByTestId('settings-debugger-clear-all')).toHaveCount(0);
      await closeSettings(esPage);

      await esPage.locator('.monaco-editor').click({ position: { x: 120, y: 36 } });
      await esPage.keyboard.press('Control+Shift+B');
      await esPage.getByRole('button', { name: /alternar consola/i }).click();
      await esPage.getByTestId('bottom-panel-debugger-tab').click();

      await expect(esPage.getByTestId('debugger-clear-all-breakpoints')).toContainText(
        /Limpiar/
      );
      await expect(esPage.getByText(/Borra/)).toHaveCount(0);
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
    await expect(page.getByTestId('debugger-drawer')).toHaveCount(0);
    await expect(page.getByTestId('toolbar-breakpoint-pill')).toHaveCount(0);

    await page.getByRole('button', { name: /toggle console/i }).click();
    await expect(page.getByTestId('bottom-panel-debugger-tab')).toBeVisible();
    await expect(page.getByTestId('bottom-panel-debugger-count')).toContainText('1');

    await openRunMenu(page);
    await expect(page.getByTestId('toolbar-debug-button')).toBeEnabled();
  });

  test('Debug pauses on the original TypeScript line with typed locals', async ({ page }) => {
    await replaceEditorText(
      page,
      [
        'const value: number = 21;',
        'const doubled: number = value * 2;',
        'console.log(doubled);',
      ].join('\n')
    );
    await page.keyboard.press('Control+Shift+B');

    await expect(page.locator('.monaco-editor .lingua-bp-glyph')).toHaveCount(1);
    await clickDebug(page);

    await expect(page.getByText(/Paused at line 3/i)).toBeVisible();
    await expect(page.locator('.monaco-editor .lingua-debugger-paused-line')).toHaveCount(1);
    await expect(page.getByTestId('debugger-locals')).toContainText('doubled: 42');

    await page.getByTestId('debugger-continue').click();
    await waitForRunCompleted(page);
  });
});
