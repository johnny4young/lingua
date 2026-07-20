/**
 * implementation closeout — real-browser coverage for the language-pack
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
  test('empty-state quick starts and Snippets picker read registry capabilities on web', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await closeActiveEditorTab(page);

    await expect(page.getByTestId('empty-state-quick-start-javascript')).toBeVisible();
    await expect(page.getByTestId('empty-state-quick-start-typescript')).toBeVisible();
    await expect(page.getByTestId('empty-state-quick-start-go')).toBeVisible();
    await expect(page.getByTestId('empty-state-quick-start-python')).toBeVisible();
    await expect(page.getByTestId('empty-state-quick-start-rust')).toBeVisible();
    await expect(page.getByTestId('empty-state-desktop-only-go')).toHaveText('Desktop only');
    await expect(page.getByTestId('empty-state-desktop-only-rust')).toHaveText('Desktop only');
    await expect(page.getByTestId('empty-state-quick-start-lua')).toHaveCount(0);

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

    await expect(page.getByTestId('empty-state-desktop-only-go')).toHaveText(
      'Solo escritorio'
    );
    await expect(page.getByTestId('empty-state-desktop-only-rust')).toHaveText(
      'Solo escritorio'
    );

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
