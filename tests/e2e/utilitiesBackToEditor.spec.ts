/**
 * Utilities › back into the editor: a tool's output goes in at the last code
 * tab's cursor as one undo step, or opens as a JSON tab of its own.
 */
import type { Page } from '@playwright/test';
import { dismissWhatsNew, expect, gotoApp, seedSession, test } from './licenseWeb.helpers';
import { NON_SECRET_TEST_JWT } from '../__fixtures__/jwt';

const AUTH = ['const claims = ', 'const left = claims.exp - Date.now() / 1000;', 'const isAdmin = claims.role === "admin";', ''].join('\n');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const EVIDENCE = process.env.LINGUA_EVIDENCE_DIR;

const COPY = {
  en: { pasted: 'Pasted a JWT token.', open: 'Open JWT Debugger', where: 'auth.ts · line 1', inserted: 'Inserted from JWT Debugger', undo: 'undo' },
  es: { pasted: 'Pegaste un token JWT.', open: 'Abrir depurador JWT', where: 'auth.ts · línea 1', inserted: 'Insertado desde Depurador JWT', undo: 'deshacer' },
} as const;

async function openJwtFromPaste(page: Page, language: 'en' | 'es', { pro = true } = {}) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await seedSession(page, {
    language,
    primeProLicense: pro,
    restoreSessionMode: 'always',
    savedTabs: [{ name: 'auth.ts', language: 'typescript', content: AUTH }],
  });
  await gotoApp(page);
  await dismissWhatsNew(page);
  await page.evaluate(async value => navigator.clipboard.writeText(value), NON_SECRET_TEST_JWT);
  await page.locator('.monaco-editor').first().click({ position: { x: 300, y: 12 } });
  await page.keyboard.press(`${MOD}+Home`);
  await page.keyboard.press('End');
  await page.keyboard.press(`${MOD}+V`);
  const banner = page.getByTestId('status-notice-banner');
  await expect(banner).toContainText(COPY[language].pasted);
  await banner.getByRole('button', { name: COPY[language].open }).click();
  await expect(page.getByTestId('jwt-payload-output')).toContainText('lingua');
}

const editorText = (page: Page) => page.locator('.monaco-editor .view-lines').first();

for (const language of ['en', 'es'] as const) {
  test(`inserts a tool's output at the cursor as one undo step (${language})`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await openJwtFromPaste(page, language);
    const insert = page.getByTestId('utility-insert-at-cursor');
    await expect(page.getByTestId('utility-insert-target')).toHaveText(COPY[language].where);
    await expect(page.getByTestId('utility-open-json-tab')).toBeVisible();
    await expect(page.getByTestId('utility-send-output-card')).toHaveCount(3);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/after-${language === 'es' ? 'es-' : ''}utilities.png` });

    await insert.click();
    const note = page.getByTestId('utility-inserted-note');
    await expect(note).toContainText(COPY[language].inserted);
    await expect(note).toContainText(COPY[language].undo);
    await expect(editorText(page)).toContainText('fixture');
    await expect(page.locator('.monaco-editor .view-overlays .lingua-inserted-line')).toHaveCount(4);
    await expect(page.locator('.monaco-editor .margin .lingua-inserted-line')).toHaveCount(4);
    await expect(page.locator('.monaco-editor .view-line', { hasText: /^const\sclaims\s=\s\{$/u })).toHaveCount(1);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/after-${language === 'es' ? 'es-' : ''}editor.png` });

    await page.keyboard.press(`${MOD}+Z`);
    await expect(note).toHaveCount(0);
    await expect(editorText(page)).not.toContainText('fixture');
    await expect(editorText(page)).toContainText('isAdmin');
    await expect(page.locator('.monaco-editor .view-line', { hasText: /^const\sclaims\s=\s*$/u })).toHaveCount(1);
  });
}

test('opens a JSON output as a tab of its own', async ({ page }) => {
  await openJwtFromPaste(page, 'en');
  await page.getByTestId('utility-open-json-tab').click();
  await expect(page.getByRole('button', { name: /untitled-.*\.json/ }).first()).toBeVisible();
  await expect(editorText(page)).toContainText('fixture');
});

for (const [name, width] of [['min', 375], ['mid', 768]] as const) {
  test(`keeps the handoff row whole at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openJwtFromPaste(page, 'en');
    const row = page.getByTestId('utility-editor-handoff');
    await expect(page.getByTestId('utility-send-output-card')).toHaveCount(3);
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    const panel = await page.locator('main').filter({ has: row }).boundingBox();
    expect(box && panel && box.x + box.width <= panel.x + panel.width + 1).toBe(true);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/after-utilities-${name}.png` });
  });
}
