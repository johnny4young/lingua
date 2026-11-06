/**
 * JS/TS diagnostics follow how Lingua runs the code: as a module that may
 * await at the top level, without type-checking JavaScript.
 *
 * Each TypeScript case carries one real type error, so a count of 1 proves the
 * language service ran and flagged nothing else.
 */

import type { Page } from '@playwright/test';
import {
  createJavaScriptTab,
  createTypeScriptTab,
  expect,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

// Manual Run keeps the scratchpad's runtime error markers out of the count.
const SESSION = {
  showStatusBar: true,
  workflowModeDefaultsByLanguage: { javascript: 'run', typescript: 'run' },
} as const;

const TYPE_ERROR = "const count: number = 'one';";

async function replaceEditorContent(page: Page, content: string): Promise<void> {
  await page.locator('.monaco-editor').click({ position: { x: 160, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(content);
}

async function expectErrors(page: Page, count: number): Promise<void> {
  await expect(page.getByTestId('status-bar-lint')).toHaveAttribute(
    'data-lint-errors',
    String(count),
    { timeout: 20_000 }
  );
}

for (const language of ['en', 'es'] as const) {
  test(`reads TypeScript tabs as modules with top-level await (${language})`, async ({ page }) => {
    await seedSession(page, { language, ...SESSION });
    await gotoApp(page);
    await createTypeScriptTab(page);

    // Script mode added TS1375 and TS1378 here.
    await replaceEditorContent(page, `await Promise.resolve(1);\n${TYPE_ERROR}`);
    await expectErrors(page, 1);

    // Script mode clashed with the DOM's global `name`.
    await replaceEditorContent(page, `const name = 'Ada';\n${TYPE_ERROR}`);
    await expectErrors(page, 1);

    await replaceEditorContent(
      page,
      `import fs from 'node:fs';\nconsole.log(fs.existsSync('.'));\n${TYPE_ERROR}`
    );
    await expectErrors(page, 1);
  });
}

test('reports JavaScript code that always fails, without type-checking it', async ({ page }) => {
  await seedSession(page, { language: 'en', ...SESSION });
  await gotoApp(page);
  await createJavaScriptTab(page);

  // TS2451 on both declarations.
  await replaceEditorContent(page, 'let total = 1;\nlet total = 2;');
  await expectErrors(page, 2);

  // A type change is valid JavaScript; only the syntax error counts.
  await replaceEditorContent(page, "let label = 0;\nlabel = 'many';\nconst broken = ;");
  await expectErrors(page, 1);
});
