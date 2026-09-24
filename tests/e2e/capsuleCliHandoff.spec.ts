import { mkdirSync, readFileSync } from 'node:fs';
import {
  applyDevLicense,
  clickRun,
  createJavaScriptTab,
  expect,
  gotoApp,
  openSettings,
  openSettingsTab,
  seedSession,
  test,
  waitForRunCompleted,
} from './licenseWeb.helpers';

const REVIEW_DIR = 'output/review/product-capsule-cli';

test('Free exports a CLI JSON file, copies separate commands and imports it inertly', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seedSession(page, { language: 'en' });
  await gotoApp(page);
  await createJavaScriptTab(page);
  await clickRun(page);
  await waitForRunCompleted(page);
  await openSettings(page);
  await openSettingsTab(page, 'account');
  const save = page.getByTestId('capsule-save-json-button');
  await expect(save).toBeEnabled();
  const downloadPromise = page.waitForEvent('download');
  await save.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('lingua-run.capsule.json');
  const downloadedPath = await download.path();
  if (!downloadedPath) throw new Error('Web download did not produce a file');
  const downloaded = JSON.parse(readFileSync(downloadedPath, 'utf8')) as {
    version: number;
    source: { content: string };
  };
  expect(downloaded.version).toBe(1);
  expect(downloaded.source.content.length).toBeGreaterThan(0);
  await page.getByTestId('capsule-cli-handoff-toggle').click();
  await expect(page.getByText('Validate without executing')).toBeVisible();
  await expect(page.getByText('Replay (executes the recorded source)')).toBeVisible();
  await page.getByTestId('capsule-cli-handoff').scrollIntoViewIfNeeded();
  if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: `${REVIEW_DIR}/handoff-en.png` });
  }
  await page.getByTestId('capsule-cli-copy-validate').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'lingua capsule validate "lingua-run.capsule.json" --json'
  );
  await page.getByTestId('capsule-cli-copy-replay').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'lingua capsule replay "lingua-run.capsule.json" --json'
  );

  await page.getByTestId('capsule-import-button').click();
  await page.getByTestId('capsule-import-file-input').setInputFiles(downloadedPath);
  await expect(page.getByTestId('capsule-import-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await openSettings(page);
  await openSettingsTab(page, 'account');
  // The Free export remains Free; inspect the gated history only after import.
  // If the preview executed the capsule, this count would exceed the one manual run.
  await applyDevLicense(page, 'Active — Monthly');
  await openSettingsTab(page, 'editor');
  await expect(page.getByText('1 run recorded')).toBeVisible();
});

test('Spanish guidance distinguishes validation from execution and reports denied clipboard', async ({ page }) => {
  await seedSession(page, { language: 'es' });
  await gotoApp(page);
  await createJavaScriptTab(page);
  await clickRun(page);
  await waitForRunCompleted(page);
  await openSettings(page);
  await openSettingsTab(page, 'account');
  await expect(page.getByTestId('capsule-save-json-button')).toBeEnabled();
  await page.getByTestId('capsule-cli-handoff-toggle').click();
  await expect(page.getByText('Validar sin ejecutar')).toBeVisible();
  await expect(page.getByText('Reproducir (ejecuta el código guardado)')).toBeVisible();
  await page.getByTestId('capsule-cli-handoff').scrollIntoViewIfNeeded();
  if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: `${REVIEW_DIR}/handoff-es.png` });
  }
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => { throw new Error('denied'); },
    });
  });
  await page.getByTestId('capsule-cli-copy-validate').click();
  await expect(page.getByTestId('status-notice-banner'))
    .toContainText('Portapapeles no disponible');
});
