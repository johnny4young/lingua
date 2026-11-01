/**
 * Run regions: %% markers split a file, the editor's Run key runs the file up
 * to the end of the region at the cursor, and its output shows under it.
 */
import type { Page } from '@playwright/test';
import { createLanguageTab, dismissWhatsNew, expect, gotoApp, replaceEditorText, seedSession, test } from './licenseWeb.helpers';

const JS = [
  'const nums = [3, 6, 1];',
  '// %% sort',
  'const sorted = [...nums].sort((a, b) => a - b);',
  'console.log("sorted", sorted);',
  '// %% bench · slow',
  'const doubled = sorted.map(n => n * 2);',
  'doubled.length',
  '// %% third',
  'console.log("third region");',
].join('\n');

async function seedRegions(page: Page, language: 'en' | 'es'): Promise<void> {
  await seedSession(page, { language, workflowModeDefaultsByLanguage: { javascript: 'run', python: 'run' } });
  await page.addInitScript(() => {
    const raw = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    raw.state.featureFlags = { runRegions: true };
    localStorage.setItem('lingua-settings', JSON.stringify(raw));
  });
}

async function moveCursorTo(page: Page, line: number): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  for (let at = 1; at < line; at += 1) await page.keyboard.press('ArrowDown');
}

test.describe('Run regions', () => {
  for (const language of ['en', 'es'] as const) {
    test(`runs the region at the cursor and shows its output under it (${language})`, async ({ page }) => {
      await seedRegions(page, language);
      await gotoApp(page);
      await replaceEditorText(page, JS);

      const chips = page.getByTestId('run-regions-chip');
      await expect(chips).toHaveText([language === 'en' ? 'Top' : 'Inicio', 'sort', 'bench', 'third']);
      await moveCursorTo(page, 6);
      await expect(chips.nth(2)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.lingua-region-active')).not.toHaveCount(0);

      await page.keyboard.press('ControlOrMeta+Enter');
      const card = page.getByTestId('run-regions-card');
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('aria-label', language === 'en' ? 'Output of region bench' : 'Salida de la región bench');
      await expect(page.getByTestId('run-regions-rows')).toContainText('L7');
      await expect(page.getByTestId('run-regions-rows')).not.toContainText('L4');
      const rows = page.getByTestId('console-entry-row');
      await expect(rows.filter({ hasText: 'sorted' })).toHaveCount(1);
      await expect(rows.filter({ hasText: 'third region' })).toHaveCount(0);

      await page.getByTestId('run-regions-insert').click();
      await expect(page.locator('.view-lines')).toContainText('doubled.length // => 3');

      await page.keyboard.press('ControlOrMeta+Shift+Enter');
      await expect(rows.filter({ hasText: 'third region' })).toHaveCount(1);
      await expect(card).toHaveCount(0);
    });
  }

  test('asks for a missing stdin line under the region and masks secrets', async ({ page }) => {
    await seedRegions(page, 'en');
    await gotoApp(page);
    await replaceEditorText(
      page,
      ['// %% ask', 'const name = prompt("Your name?");', 'const pin = prompt("PIN code");', 'console.log("hi", name, pin.length);'].join('\n')
    );
    await moveCursorTo(page, 2);
    await page.keyboard.press('ControlOrMeta+Enter');

    const stdin = page.getByTestId('run-regions-stdin');
    await expect(stdin).toContainText('prompt · Your name? · L2');
    const input = page.getByTestId('run-regions-stdin-input');
    await expect(input).toHaveAttribute('type', 'text');
    await expect(input).toBeFocused();
    await input.fill('Ada');
    await input.press('Enter');

    await expect(stdin).toContainText('prompt · PIN code · L3');
    await expect(input).toHaveAttribute('type', 'password');
    await input.fill('1234');
    await input.press('Enter');

    await expect(page.getByTestId('run-regions-rows')).toContainText('hi Ada 4');
    await expect(stdin).toHaveCount(0);
    await expect(page.getByTestId('bottom-panel-stdin-count')).toHaveText('1');
  });

  test('runs a plain file with the Run shortcut inside the editor', async ({ page }) => {
    await seedRegions(page, 'en');
    await gotoApp(page);
    await replaceEditorText(page, 'console.log("plain-run-marker");');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByTestId('console-entry-row').filter({ hasText: 'plain-run-marker' })).toHaveCount(1);
    await expect(page.locator('.view-line')).toHaveCount(1);
  });

  test('splits Python at # %% and keeps the state of the regions above', async ({ page }) => {
    // Pyodide boots on the first run: the runner allows 90 s for it.
    test.setTimeout(180_000);
    await seedRegions(page, 'en');
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createLanguageTab(page, /^Python\b/i, /PY .*\.py/i);
    await replaceEditorText(page, ['base = 20', '# %% double', 'print("doubled", base * 2)', '# %% later', 'print("later region")'].join('\n'));
    await expect(page.getByTestId('run-regions-chip')).toHaveText(['Top', 'double', 'later']);
    await moveCursorTo(page, 3);
    await page.getByTestId('run-regions-run').click();
    await expect(page.getByTestId('run-regions-rows')).toContainText('doubled 40', { timeout: 120_000 });
    await expect(page.getByTestId('console-entry-row').filter({ hasText: 'later region' })).toHaveCount(0);

    await replaceEditorText(page, ['base = 20', '# %% ask', 'name = input("Name: ")', 'print("hello", name, base)'].join('\n'));
    await moveCursorTo(page, 3);
    await page.getByTestId('run-regions-run').click();
    await expect(page.getByTestId('run-regions-stdin')).toContainText('prompt · Name: · L3', { timeout: 30_000 });
    await page.getByTestId('run-regions-stdin-input').fill('Ada');
    await page.getByTestId('run-regions-stdin-input').press('Enter');
    await expect(page.getByTestId('run-regions-rows')).toContainText('hello Ada 20', { timeout: 30_000 });
  });
});
