import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  expect,
  gotoApp,
  openCommandPalette,
  seedSession,
  test,
} from './licenseWeb.helpers';

const evidenceDir = 'output/review/project-sequence/t08-maintainability';

function captureEnabled(): boolean {
  return process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1';
}

async function replaceSqlEditorText(page: Page, source: string): Promise<void> {
  const editor = page
    .getByTestId('sql-query-editor-monaco')
    .locator('.monaco-editor');
  await editor.click({ position: { x: 120, y: 36 } });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(source);
}

test.describe('maintainability split — preserved UI surfaces', () => {
  test('keeps tabs, palette, notebook, and SQL results operational in English', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await openCommandPalette(page);
    if (captureEnabled()) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({ path: `${evidenceDir}/web-en-command-palette-tabs.png` });
    }
    await page.keyboard.press('Escape');

    await page.keyboard.press('ControlOrMeta+Alt+N');
    await expect(page.getByTestId('notebook-view')).toBeVisible();
    await expect(page.getByTestId('notebook-toolbar-add-code')).toBeVisible();
    if (captureEnabled()) {
      await page.screenshot({ path: `${evidenceDir}/web-en-notebook.png` });
    }

    await page.keyboard.press('ControlOrMeta+Alt+S');
    await expect(page.getByTestId('sql-workspace-panel')).toBeVisible();
    await page.getByTestId('sql-query-list-create').click();
    await replaceSqlEditorText(page, 'SELECT 1 AS value');
    await expect(page.getByTestId('sql-query-editor-run')).toBeEnabled();
    await page.getByTestId('sql-query-editor-run').click();
    await expect(page.getByTestId('sql-result-preview-table')).toBeVisible();
    if (captureEnabled()) {
      await page.screenshot({ path: `${evidenceDir}/web-en-sql-result.png` });
    }

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });

  test('loads the split notebook and palette surfaces in Spanish', async ({ page }) => {
    await seedSession(page, { language: 'es', primeProLicense: true });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+Alt+N');
    await expect(page.getByTestId('notebook-toolbar-add-code')).toContainText(
      'Agregar código'
    );
    await openCommandPalette(page);
    if (captureEnabled()) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({ path: `${evidenceDir}/web-es-palette-notebook.png` });
    }
  });
});
