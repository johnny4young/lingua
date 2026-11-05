/**
 * One TypeScript language service, started on first use.
 *
 * Lingua's Monaco patch gives JavaScript and TypeScript a single worker and
 * holds it until an editor interaction. Lingua's models have no file
 * extension, so the shared worker must still read each model as the language
 * on screen: a TypeScript tab parsed as JavaScript flags every annotation, and
 * a JavaScript tab parsed as TypeScript flags none. The status bar error count
 * tells those apart.
 */

import type { Page } from '@playwright/test';
import {
  createAdditionalJavaScriptTab,
  createTypeScriptTab,
  expect,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

const typeScriptWorkers = (page: Page) =>
  page.workers().filter(worker => /ts\.worker/.test(worker.url()));

async function replaceEditorContent(page: Page, content: string): Promise<void> {
  await page.locator('.monaco-editor').click({ position: { x: 160, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(content);
}

// Manual Run keeps the scratchpad's runtime error markers out of the diagnostic count.
const SESSION = {
  showStatusBar: true,
  workflowModeDefaultsByLanguage: { javascript: 'run', typescript: 'run' },
} as const;

async function expectErrors(page: Page, count: number): Promise<void> {
  await expect(page.getByTestId('status-bar-lint')).toHaveAttribute(
    'data-lint-errors',
    String(count),
    { timeout: 20_000 }
  );
}

// JavaScript only allows annotations in TypeScript files: one error.
const JS_WITH_ANNOTATION = 'const count: number = 1;';
// Two type errors as TypeScript; three annotation errors if read as JavaScript.
const TS_WITH_TWO_TYPE_ERRORS = [
  'const count: number = 1;',
  'const label: string = count;',
  'const flag: boolean = count;',
].join('\n');

test.describe('TypeScript language service', () => {
  test('starts no worker until an editor is used, then one for both languages', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en', ...SESSION });
    await gotoApp(page);
    await expect(page.locator('.monaco-editor')).toBeVisible();
    // A model on screen used to start a worker within about a second.
    await page.waitForTimeout(2_000);
    expect(typeScriptWorkers(page)).toHaveLength(0);

    await createAdditionalJavaScriptTab(page);
    await replaceEditorContent(page, JS_WITH_ANNOTATION);
    await expectErrors(page, 1);

    await createTypeScriptTab(page);
    await replaceEditorContent(page, TS_WITH_TWO_TYPE_ERRORS);
    await expectErrors(page, 2);

    await page.getByRole('button', { name: /JS .*\.js/i }).last().click();
    await expectErrors(page, 1);
    expect(typeScriptWorkers(page)).toHaveLength(1);
  });

  test('starts the worker from a TypeScript tab and still reads JavaScript as JavaScript', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en', ...SESSION });
    await gotoApp(page);
    await createTypeScriptTab(page);
    await replaceEditorContent(page, TS_WITH_TWO_TYPE_ERRORS);
    await expectErrors(page, 2);

    await createAdditionalJavaScriptTab(page);
    await replaceEditorContent(page, JS_WITH_ANNOTATION);
    await expectErrors(page, 1);
    expect(typeScriptWorkers(page)).toHaveLength(1);
  });

  test('loads the Node typings into the shared service for both languages', async ({ page }) => {
    await seedSession(page, { language: 'en', ...SESSION });
    await gotoApp(page);
    await createTypeScriptTab(page);
    // Without the typings both lines fail to find `process`; with them only the second fails.
    await replaceEditorContent(
      page,
      [
        'const home: string | undefined = process.env.HOME;',
        'const platform: number = process.platform;',
      ].join('\n')
    );
    await expectErrors(page, 1);

    await createAdditionalJavaScriptTab(page);
    await replaceEditorContent(page, "import * as fs from 'node:fs';\nfs.readFileS");
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.suggest-widget')).toContainText('readFileSync');
    expect(typeScriptWorkers(page)).toHaveLength(1);
  });

  test('renders the same diagnostics in Spanish', async ({ page }) => {
    await seedSession(page, { language: 'es', ...SESSION });
    await gotoApp(page);
    await createTypeScriptTab(page);
    await replaceEditorContent(page, TS_WITH_TWO_TYPE_ERRORS);
    await expectErrors(page, 2);
    await expect(page.getByTestId('status-bar-lint')).toContainText('2');
  });
});
