import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  createAdditionalJavaScriptTab,
  createJavaScriptTab,
  createLanguageTab,
  expect,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';

const evidenceDir = 'output/review/d4-d5-d7-discoverability';

function captureEnabled(): boolean {
  return process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1';
}

async function replaceEditorContent(page: Page, content: string): Promise<void> {
  await page
    .locator('.monaco-editor')
    .first()
    .click({ position: { x: 150, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(content);
}

test.describe('IT2-D4 magic comment discoverability', () => {
  test('suggests the real directive catalog inside JavaScript comments', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await createJavaScriptTab(page);
    await replaceEditorContent(page, '// @');

    await page.keyboard.press('Control+Space');
    const suggestions = page.locator('.suggest-widget');
    await expect(suggestions).toBeVisible();
    await expect(suggestions).toContainText('@watch');
    await expect(suggestions).toContainText('@timeout');
    await expect(suggestions).toContainText('@git-ignore-status');

    if (captureEnabled()) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: `${evidenceDir}/d4-web-en-magic-comment-completions.png`,
      });
    }
  });

  test('suggests directives in Python and explains timeout hover in Spanish', async ({ page }) => {
    await seedSession(page, { language: 'es', primeProLicense: true });
    await gotoApp(page);
    await createLanguageTab(page, /^Python\b/i, /PY .*\.py/i);
    await replaceEditorContent(page, '# @');

    await page.keyboard.press('Control+Space');
    await expect(page.locator('.suggest-widget')).toContainText('@watch');

    if (captureEnabled()) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: `${evidenceDir}/d4-web-es-python-magic-comment-completions.png`,
      });
    }

    await page.keyboard.press('Escape');

    await createAdditionalJavaScriptTab(page);
    await replaceEditorContent(page, '\n\n\n\n// @timeout 5s');
    await page.keyboard.press('End');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+K`);
    await page.keyboard.press(`${modifier}+I`);

    const hover = page.locator('.monaco-editor .monaco-hover:not(.hidden)').first();
    await expect(hover).toBeVisible();
    await expect(hover).toContainText('Comentario mágico de Lingua');
    await expect(hover).toContainText('Ajusta el tiempo límite');
    await expect(hover).toContainText('Ejemplo: // @timeout 5s');

    if (captureEnabled()) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: `${evidenceDir}/d4-web-es-magic-comment-hover.png`,
      });
    }
  });
});
