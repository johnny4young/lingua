import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { compressToEncodedURIComponent } from 'lz-string';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

const evidenceDir = path.resolve(process.cwd(), 'output/playwright/playground-url-import');

const source = [
  'type User = { id: number; name: string };',
  '',
  'const users: User[] = [',
  '  { id: 1, name: "Ada" },',
  '  { id: 2, name: "Linus" },',
  '];',
  '',
  'console.log(users.map(user => user.name));',
].join('\n');

const typescriptPlaygroundUrl = `https://www.typescriptlang.org/play/#code/${compressToEncodedURIComponent(source)}`;

async function openImportOverlay(page: import('@playwright/test').Page): Promise<void> {
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}',
  });
  await page.keyboard.press('ControlOrMeta+Alt+I');
  await expect(page.getByTestId('import-preview-overlay')).toBeVisible();
}

test.describe('Playground URL import', () => {
  test.beforeAll(() => {
    mkdirSync(evidenceDir, { recursive: true });
  });

  test('previews TypeScript locally in English and opens exactly one tab', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openImportOverlay(page);

    await page.getByTestId('import-preview-playground-url').fill(typescriptPlaygroundUrl);
    await page.getByTestId('import-preview-playground-preview').click();

    await expect(page.getByTestId('import-preview-playground-source')).toContainText('type User');
    await expect(page.getByTestId('import-preview-detected')).toContainText('Playground URL');
    await expect(page.getByTestId('import-preview-confirm')).toHaveText('Open source in a tab');
    await page.getByRole('dialog').screenshot({
      path: path.join(evidenceDir, 'en-typescript-preview.png'),
    });

    await page.getByTestId('import-preview-confirm').click();
    await expect(page.getByTestId('import-preview-overlay')).toBeHidden();
    await expect(
      page.getByTestId('editor-tab-filename').filter({ hasText: /^typescript-playground\.ts$/i })
    ).toHaveCount(1);
  });

  test('renders the same bounded preview in Spanish', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openImportOverlay(page);

    await page.getByTestId('import-preview-playground-url').fill(typescriptPlaygroundUrl);
    await page.getByTestId('import-preview-playground-preview').click();

    await expect(page.getByTestId('import-preview-playground-source')).toContainText('type User');
    await expect(page.getByTestId('import-preview-detected')).toContainText('URL de playground');
    await expect(page.getByTestId('import-preview-confirm')).toHaveText('Abrir fuente en un tab');
    await page.getByRole('dialog').screenshot({
      path: path.join(evidenceDir, 'es-typescript-preview.png'),
    });
  });

  test('rejects CodePen with Spanish export guidance and no confirm action', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openImportOverlay(page);

    await page
      .getByTestId('import-preview-playground-url')
      .fill('https://codepen.io/example/pen/abc123');
    await page.getByTestId('import-preview-playground-preview').click();

    await expect(page.getByTestId('import-preview-reject-detail')).toContainText(
      'API pública de lectura estable'
    );
    await expect(page.getByTestId('import-preview-confirm')).toBeDisabled();
    await page.getByRole('dialog').screenshot({
      path: path.join(evidenceDir, 'es-codepen-rejection.png'),
    });
  });
});
