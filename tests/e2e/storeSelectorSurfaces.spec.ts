import {
  closeSnippets,
  createJavaScriptTab,
  expect,
  gotoApp,
  openSettings,
  openSettingsTab,
  openSnippets,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

for (const language of ['en', 'es'] as const) {
  test(`selected store slices preserve snippets and theme controls (${language})`, async ({
    page,
  }) => {
    await seedSession(page, { language, snippetCount: 2 });
    await gotoApp(page);
    await createJavaScriptTab(page);
    await openSnippets(page);
    await expect(page.getByRole('button', { name: 'Seed snippet 1 Seeded snippet' })).toBeVisible();
    await page.getByRole('button', { name: 'Seed snippet 2 Seeded snippet' }).click();
    await expect(page.getByRole('heading', { name: 'Seed snippet 2' })).toBeVisible();
    await closeSnippets(page);
    await openSettings(page);
    await openSettingsTab(page, 'editor');
    const preset = page.locator('section').filter({
      has: page.getByText(language === 'en' ? 'Theme preset' : 'Preset de tema', { exact: true }),
    });
    await expect(
      preset.getByRole('button', { name: language === 'en' ? 'Export' : 'Exportar', exact: true })
    ).toBeVisible();
    const importButton = preset.getByRole('button', {
      name: language === 'en' ? 'Import' : 'Importar',
      exact: true,
    });
    await expect(importButton).toBeVisible();
    // Exercise failure handling without opening an OS picker or writing user files.
    await page.evaluate(() => {
      window.lingua.fs.selectFile = async () => {
        throw new Error('fixture preset read failure');
      };
    });
    await importButton.click();
    await expect(page.getByText(/fixture preset read failure/)).toBeVisible();
  });
}
