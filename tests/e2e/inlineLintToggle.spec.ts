/**
 * Settings › Editor › Inline lint silences Monaco's own JS/TS diagnostics.
 *
 * The toggle used to write to `monaco.languages.typescript`, which Lingua's
 * `editor.api.js` import never defines, so the squiggles stayed. The status
 * bar error count shows whether Monaco's markers are on the model.
 */

import type { Page } from '@playwright/test';
import {
  closeSettings,
  createJavaScriptTab,
  createTypeScriptTab,
  expect,
  gotoApp,
  openSettings,
  openSettingsTab,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

// Manual Run keeps the scratchpad's runtime error markers out of the count.
const SESSION = {
  showStatusBar: true,
  workflowModeDefaultsByLanguage: { javascript: 'run', typescript: 'run' },
} as const;

const JS_WITH_SYNTAX_ERROR = 'const broken = ;';
const TS_WITH_TYPE_ERROR = "const count: number = 'one';";

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

async function toggleInlineLint(page: Page, label: RegExp): Promise<void> {
  await openSettings(page);
  await openSettingsTab(page, 'editor');
  await page.getByRole('switch', { name: label }).click();
  await closeSettings(page);
}

for (const { language, typeScriptLabel, javaScriptLabel } of [
  {
    language: 'en',
    typeScriptLabel: /Inline lint · TypeScript/,
    javaScriptLabel: /Inline lint · JavaScript/,
  },
  {
    language: 'es',
    typeScriptLabel: /Lint en línea · TypeScript/,
    javaScriptLabel: /Lint en línea · JavaScript/,
  },
] as const) {
  test(`turns Monaco's TypeScript and JavaScript diagnostics off and on per language (${language})`, async ({
    page,
  }) => {
    await seedSession(page, { language, ...SESSION });
    await gotoApp(page);
    await createJavaScriptTab(page);
    await replaceEditorContent(page, JS_WITH_SYNTAX_ERROR);
    await expectErrors(page, 1);

    await createTypeScriptTab(page);
    await replaceEditorContent(page, TS_WITH_TYPE_ERROR);
    await expectErrors(page, 1);

    await toggleInlineLint(page, typeScriptLabel);
    await expectErrors(page, 0);

    // TypeScript's switch leaves JavaScript alone.
    await page.getByRole('button', { name: /JS .*\.js/i }).first().click();
    await expectErrors(page, 1);
    await toggleInlineLint(page, javaScriptLabel);
    await expectErrors(page, 0);
    await toggleInlineLint(page, javaScriptLabel);
    await expectErrors(page, 1);

    await page.getByRole('button', { name: /TS .*\.ts/i }).last().click();
    await expectErrors(page, 0);
    await toggleInlineLint(page, typeScriptLabel);
    await expectErrors(page, 1);
  });
}
