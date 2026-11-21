/**
 * real-browser coverage for the language-pack
 * UI consumers added after Toolbar / FileTree.
 */

import {
  closeActiveEditorTab,
  expect,
  gotoApp,
  openSnippets,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Language-pack capability UI', () => {
  test('Start language tiles and Snippets picker read registry capabilities on web', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await closeActiveEditorTab(page);

    for (const language of ['javascript', 'typescript', 'python', 'lua']) {
      await expect(page.getByTestId(`start-new-${language}`)).toBeVisible();
      await expect(page.getByTestId(`start-new-${language}-availability`)).toHaveText(
        'in the browser'
      );
    }
    for (const language of ['go', 'rust']) {
      await expect(page.getByTestId(`start-new-${language}`)).toBeVisible();
      await expect(page.getByTestId(`start-new-${language}-availability`)).toHaveText(
        'Desktop only'
      );
    }

    await openSnippets(page);
    const options = await page
      .getByTestId('snippets-language-select')
      .locator('option')
      .allTextContents();

    expect(options).toEqual(
      expect.arrayContaining([
        'JavaScript',
        'TypeScript',
        'Go (desktop only)',
        'Python',
        'Rust (desktop only)',
        'Lua',
      ])
    );
    expect(options.find(option => option.startsWith('JavaScript'))).toBe('JavaScript');
    expect(options.find(option => option.startsWith('Python'))).toBe('Python');
    expect(options.find(option => option.startsWith('Lua'))).toBe('Lua');
  });

  test('desktop-only badges and option suffixes localize in Spanish', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await closeActiveEditorTab(page);

    await expect(page.getByTestId('start-new-go-availability')).toHaveText('Solo escritorio');
    await expect(page.getByTestId('start-new-rust-availability')).toHaveText('Solo escritorio');

    await openSnippets(page);
    const options = await page
      .getByTestId('snippets-language-select')
      .locator('option')
      .allTextContents();

    expect(options).toEqual(
      expect.arrayContaining(['Go (solo escritorio)', 'Rust (solo escritorio)', 'Lua'])
    );
  });
});
