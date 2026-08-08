import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  createJavaScriptTab,
  expect,
  gotoApp,
  openConsole,
  seedSession,
  selectWorkflowMode,
  test,
} from './licenseWeb.helpers';
import { isKnownBenignConsoleError } from './consoleErrorFilter';

const screenshotDir = path.resolve(process.cwd(), 'output/playwright/debugger-expressions');

test.describe.configure({ mode: 'serial' });

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
  for (let index = 1; index < line; index += 1) await page.keyboard.press('ArrowDown');
}

async function addBreakpoint(page: Page, line: number) {
  await moveEditorCursorToLine(page, line);
  await page.keyboard.press('Control+Shift+B');
}

test.beforeAll(() => {
  fs.rmSync(screenshotDir, { recursive: true, force: true });
  fs.mkdirSync(screenshotDir, { recursive: true });
});

for (const locale of ['en', 'es'] as const) {
  test(`${locale} conditional breakpoint, watch, and logpoint`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error' && !isKnownBenignConsoleError(message.text())) {
        errors.push(message.text());
      }
    });
    page.on('pageerror', error => {
      if (!isKnownBenignConsoleError(error.message)) errors.push(error.message);
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await seedSession(page, { language: locale });
    await gotoApp(page);
    await createJavaScriptTab(page);
    await replaceEditorText(
      page,
      [
        'let count = 1;',
        'count += 1;',
        'const doubled = count * 2;',
        'console.log(`done:${doubled}`);',
      ].join('\n')
    );

    await addBreakpoint(page, 2);
    await addBreakpoint(page, 3);
    await openConsole(page);
    await page.getByTestId('bottom-panel-debugger-tab').click();

    await page.getByTestId('debugger-breakpoint-mode-2').selectOption('logpoint');
    await page.getByTestId('debugger-breakpoint-log-2').fill('before increment {count}');
    await page.getByTestId('debugger-breakpoint-mode-3').selectOption('conditional');
    await page.getByTestId('debugger-breakpoint-condition-3').fill('count === 2');
    await page.getByTestId('debugger-watch-input').fill('count * 2');
    await page.getByTestId('debugger-watch-add').click();

    await selectWorkflowMode(page, 'debug');
    await expect(page.getByTestId('debugger-drawer')).toContainText(
      locale === 'es' ? /Pausado en línea 3/u : /Paused at line 3/u
    );
    await expect(page.getByTestId('debugger-watches')).toContainText('count * 2');
    await expect(page.getByTestId('debugger-watches')).toContainText('4');
    await expect(page.locator('.lingua-inline-result-value')).toContainText(['before increment 1']);
    await expect(page.locator('.monaco-editor .lingua-bp-glyph--logpoint')).toHaveCount(1);
    await expect(page.locator('.monaco-editor .lingua-bp-glyph--conditional')).toHaveCount(1);

    const transientNotice = page.getByTestId('status-notice-banner');
    if (await transientNotice.isVisible().catch(() => false)) {
      await transientNotice.getByRole('button').last().click();
      await expect(transientNotice).toHaveCount(0);
    }

    const bottomPanelHandle = page.getByRole('separator').last();
    const handleBox = await bottomPanelHandle.boundingBox();
    if (handleBox) {
      const handleX = handleBox.x + handleBox.width / 2;
      const handleY = handleBox.y + handleBox.height / 2;
      await page.mouse.move(handleX, handleY);
      await page.mouse.down();
      await page.mouse.move(handleX, handleY - 220, { steps: 8 });
      await page.mouse.up();
    }
    await expect(page.getByTestId('debugger-breakpoint-condition-3')).toBeVisible();

    const screenshotPath = path.join(screenshotDir, `debugger-expressions-${locale}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled' });
    await testInfo.attach(`debugger-expressions-${locale}.png`, {
      path: screenshotPath,
      contentType: 'image/png',
    });
    expect(errors).toEqual([]);

    await page.getByTestId('debugger-continue').click();
  });
}
