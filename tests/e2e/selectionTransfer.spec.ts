import { mkdirSync } from 'node:fs';
import {
  createJavaScriptTab,
  expect,
  gotoApp,
  openCommandPalette,
  paletteInput,
  seedSession,
  test,
} from './licenseWeb.helpers';

async function selectMiddleLine(page: import('@playwright/test').Page) {
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await editor.click({ position: { x: 160, y: 42 } });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('firstLine();\nselectedLine();\nlastLine();');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
}

test('Free palette copies only the explicit middle-line selection with a safe reference', async ({ page, context }) => {
  await seedSession(page, { language: 'en' });
  await gotoApp(page);
  await createJavaScriptTab(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
  await selectMiddleLine(page);

  await openCommandPalette(page);
  await paletteInput(page).fill('copy with context');
  const contextAction = page.getByRole('option', { name: /Copy with context/i });
  await expect(contextAction).toBeEnabled();
  await contextAction.click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/\.js:2\n```js\nselectedLine\(\);\n```/u);
  expect(copied).not.toContain('firstLine');
  expect(copied).not.toContain('lastLine');
  expect(copied).not.toMatch(/\/Users\/|[A-Za-z]:\\/u);

  await editorClickToClearSelection(page);
  await openCommandPalette(page);
  await paletteInput(page).fill('copy reference');
  await expect(page.getByRole('option', { name: /Copy reference/i })).toBeDisabled();
});

test('Monaco context menu exposes the Free selection actions without a new shortcut', async ({ page, context }) => {
  await seedSession(page, { language: 'en' });
  await gotoApp(page);
  await createJavaScriptTab(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('sentinel'));
  await selectMiddleLine(page);
  await page.keyboard.press('Shift+F10');
  const referenceAction = page.getByRole('menuitem', { name: 'Copy reference' });
  const contextAction = page.getByRole('menuitem', { name: 'Copy with context' });
  await expect(referenceAction).toBeVisible();
  await expect(contextAction).toBeVisible();
  await expect(referenceAction).toBeEnabled();
  if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
    mkdirSync('output/review/product-selection-transfer', { recursive: true });
    await page.screenshot({ path: 'output/review/product-selection-transfer/context-menu-en.png' });
  }
  // Monaco deliberately defers its mouseup action listener for 100ms after
  // opening a menu so the opening gesture cannot activate an item by accident.
  await page.waitForTimeout(150);
  await referenceAction.click();
  await expect(page.getByText('Reference copied.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\.js:2$/u);
});

test('Spanish copy reports denied clipboard writes without leaking unselected code', async ({ page, context }) => {
  await seedSession(page, { language: 'es' });
  await gotoApp(page);
  await createJavaScriptTab(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await selectMiddleLine(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => { throw new Error('denied'); },
    });
  });
  await openCommandPalette(page);
  await paletteInput(page).fill('copiar referencia');
  const action = page.getByRole('option', { name: /Copiar referencia/i });
  await expect(action).toBeEnabled();
  if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
    mkdirSync('output/review/product-selection-transfer', { recursive: true });
    await page.screenshot({ path: 'output/review/product-selection-transfer/palette-es.png' });
  }
  await action.click();
  await expect(page.getByText(/Portapapeles no disponible/u)).toBeVisible();
});

async function editorClickToClearSelection(page: import('@playwright/test').Page) {
  await page.locator('.monaco-editor').first().click({ position: { x: 160, y: 42 } });
}
