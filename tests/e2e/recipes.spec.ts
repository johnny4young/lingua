/**
 * implementation — e2e for the Recipes overlay.
 *
 * Acceptance: Mod+Alt+L opens the Recipes overlay from anywhere. EN
 * + ES locales render with tuteo copy. The full open + Run + Test
 * flow is pinned here because the assertion runner depends on real
 * worker message ordering.
 */

import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

async function replaceActiveEditor(page: Page, source: string): Promise<void> {
  const editor = page.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await editor.click({ position: { x: 160, y: 42 } });
  await page.keyboard.press('ControlOrMeta+A');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  await page.evaluate(
    async (text) => navigator.clipboard.writeText(text),
    source
  );
  // Pasting a multi-line program preserves its indentation. `insertText`
  // models typing and Monaco auto-indents every newline, which corrupts
  // nested Python blocks while remaining invisible in flattened snapshots.
  await page.keyboard.press('ControlOrMeta+V');
}

test.describe('Recipes overlay — Mod+Alt+L binding ', () => {
  test('opens via Mod+Alt+L (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+L');

    await expect(page.getByTestId('recipes-overlay')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^recipes$/i })).toBeVisible();
  });

  test('localizes the overlay in Spanish (tuteo)', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+L');

    await expect(page.getByTestId('recipes-overlay')).toBeVisible();
    await expect(page.getByRole('heading', { name: /^recetas$/i })).toBeVisible();
    await expect(page.getByTestId('recipes-cancel')).toHaveText(/cancelar/i);
  });

  test('opens a recipe and renders all Run + Test assertion results', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.getByRole('button', { name: /close welcome\.js/i }).click();
    await expect(page.getByRole('button', { name: /welcome\.js/i })).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+Alt+L');
    await page.getByTestId('recipes-search-input').fill('vowels');
    await page
      .getByTestId('recipes-list-row')
      .filter({ hasText: 'Count vowels in a string' })
      .click();

    await expect(page.getByTestId('recipe-run-panel')).toHaveAttribute(
      'data-recipe-id',
      'js-count-vowels'
    );
    await page.getByTestId('recipe-run-panel-run').click();

    await expect(page.getByTestId('recipe-run-panel-result-row')).toHaveCount(3);
    await expect(
      page.locator('[data-assertion-id="hello-world"]')
    ).toHaveAttribute('data-status', 'fail');
    await expect(
      page.locator('[data-assertion-id="case-insensitive"]')
    ).toHaveAttribute('data-status', 'fail');
    await expect(
      page.locator('[data-assertion-id="no-vowels"]')
    ).toHaveAttribute('data-status', 'pass');
  });

  test('runs a TypeScript recipe through failure and all-passed states', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.getByRole('button', { name: /close welcome\.js/i }).click();
    await page.keyboard.press('ControlOrMeta+Alt+L');
    await page.getByTestId('recipes-filter-typescript').click();
    await page
      .getByTestId('recipes-list-row')
      .filter({ hasText: 'Build a generic keyBy helper' })
      .click();

    await expect(
      page.getByTestId('editor-tab-activation').filter({
        hasText: 'ts-generic-key-by.ts',
      })
    ).toBeVisible();
    await page.getByTestId('recipe-run-panel-run').click();
    await expect(page.getByTestId('recipe-run-panel-result-row')).toHaveCount(3);
    await expect(
      page.locator(
        '[data-testid="recipe-run-panel-result-row"][data-status="fail"]'
      )
    ).toHaveCount(2);
    await expect(
      page.locator(
        '[data-testid="recipe-run-panel-result-row"][data-status="pass"]'
      )
    ).toHaveCount(1);

    await replaceActiveEditor(
      page,
      [
        'type User = { id: string; name: string };',
        'function keyBy<T, K extends PropertyKey>(',
        '  items: readonly T[],',
        '  getKey: (item: T) => K',
        '): Record<K, T> {',
        '  const result = {} as Record<K, T>;',
        '  for (const item of items) result[getKey(item)] = item;',
        '  return result;',
        '}',
        'const users: User[] = [',
        '  { id: "ana", name: "Ana" },',
        '  { id: "lin", name: "Lin" },',
        '  { id: "sam", name: "Sam" },',
        '];',
        'const usersById = keyBy(users, (user) => user.id);',
      ].join('\n')
    );
    await page.getByTestId('recipe-run-panel-run').click();

    await expect(page.locator('[data-status="pass"]')).toHaveCount(3);
    await expect(page.getByTestId('recipe-run-panel-summary')).toContainText(
      /all assertions passed/i
    );
  });

  test('runs a Python recipe end-to-end with Spanish UI copy', async ({ page }) => {
    test.setTimeout(60_000);
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.getByRole('button', { name: /cerrar welcome\.js/i }).click();
    await page.keyboard.press('ControlOrMeta+Alt+L');
    await page.getByTestId('recipes-filter-python').click();
    await page
      .getByTestId('recipes-list-row')
      .filter({ hasText: 'Cuenta frecuencias de palabras' })
      .click();

    await expect(
      page.getByTestId('editor-tab-activation').filter({
        hasText: 'py-word-frequency.py',
      })
    ).toBeVisible();
    await expect(page.getByTestId('recipe-run-panel-run')).toContainText(
      /ejecuta \+ prueba/i
    );
    await page.getByTestId('recipe-run-panel-run').click();
    await expect(page.getByTestId('recipe-run-panel-result-row')).toHaveCount(3);
    await expect(page.locator('[data-status="fail"]')).toHaveCount(2);
    await expect(page.locator('[data-status="pass"]')).toHaveCount(1);

    // The Pyodide worker is persistent. Pin a second execution before any
    // editor change so recipe-owned print helpers cannot leak across runs.
    await page.getByTestId('recipe-run-panel-run').click();
    await expect(page.locator('[data-status="fail"]')).toHaveCount(2);
    await expect(page.locator('[data-status="pass"]')).toHaveCount(1);

    await replaceActiveEditor(
      page,
      [
        'import re',
        'def word_frequency(text: str) -> dict[str, int]:',
        '    counts: dict[str, int] = {}',
        '    for word in re.findall(r"[A-Za-z0-9]+", text.lower()):',
        '        counts[word] = counts.get(word, 0) + 1',
        '    return counts',
      ].join('\n')
    );
    await page.getByTestId('recipe-run-panel-run').click();

    await expect(page.locator('[data-status="pass"]')).toHaveCount(3);
    await expect(page.getByTestId('recipe-run-panel-summary')).toContainText(
      /todas las pruebas pasaron/i
    );
  });
});
