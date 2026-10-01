import { readFile } from 'node:fs/promises';
import { parseCapsuleRegressionSuite } from '../../src/shared/capsuleRegressionSuite';
import {
  clickRun,
  expect,
  gotoApp,
  seedSession,
  test,
  waitForRunCompleted,
} from './licenseWeb.helpers';
for (const language of ['en', 'es'] as const) {
  test(`explicit regression export and inert import (${language})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: async () => {
          const root = await navigator.storage.getDirectory();
          return root.getDirectoryHandle('regression-cases', { create: true });
        },
      });
    });
    await seedSession(page, {
      language,
      primeProLicense: true,
      workflowModeDefaultsByLanguage: { javascript: 'run' },
    });
    await gotoApp(page);
    await page.evaluate(async () => {
      const dir = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('regression-cases', { create: true });
      const file = await dir.getFileHandle('hello.js', { create: true });
      const writer = await file.createWritable();
      await writer.write('const answer = 42;');
      await writer.close();
    });
    await page.keyboard.press('ControlOrMeta+Shift+P');
    await page
      .getByRole('combobox', { name: /command palette|paleta de comandos/i })
      .fill(language === 'en' ? 'Open project folder' : 'Abrir carpeta de proyecto');
    await page
      .getByRole('option', { name: language === 'en' ? /Open project folder/ : /Abrir carpeta/ })
      .click();
    const file = page.getByRole('treeitem', { name: 'hello.js', exact: true });
    if (!(await file.isVisible()))
      await page.getByRole('button', { name: /Toggle sidebar|Alternar barra lateral/ }).click();
    await file.getByRole('button').click();
    await clickRun(page);
    await waitForRunCompleted(page);
    await expect(page.getByTestId('recent-runs-pill')).toBeVisible();
    await page.getByTestId('action-pill-browse-capsules').click();
    await page.getByTestId('capsule-prepare-regression').first().click();
    const dialog = page.getByTestId('capsule-regression-dialog');
    const exportButton = dialog.getByRole('button', {
      name: language === 'en' ? 'Export case as suite' : 'Exporta el caso como suite',
    });
    await expect(exportButton).toBeDisabled();
    await dialog.getByRole('combobox').selectOption({ label: 'hello.js' });
    await expect(dialog.getByTestId('regression-target-preview')).toContainText('answer = 42');
    await expect(exportButton).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await expect(exportButton).toBeEnabled();
    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    const raw = await readFile(path!, 'utf8');
    const suite = parseCapsuleRegressionSuite(raw);
    expect(suite.ok).toBe(true);
    if (!suite.ok) throw new Error(suite.reason);
    expect(suite.suite.cases[0]!.target).toBe('hello.js');
    expect(suite.suite.cases[0]!.baseline.result.stdout ?? '').toBe('');
    expect(suite.suite.cases[0]!.baseline.source.content).toBe('const answer = 42;');
    expect(raw).not.toContain('/Users/');
    const picker = dialog.locator('input[type=file]');
    await picker.setInputFiles({
      name: 'suite.json',
      mimeType: 'application/json',
      buffer: Buffer.from(raw),
    });
    await expect(dialog.getByTestId('regression-import-preview')).toContainText('hello.js');
    const capsuleCount = await page.getByTestId('capsule-prepare-regression').count();
    await picker.setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{}'),
    });
    await expect(dialog.getByRole('status')).toContainText(
      language === 'en' ? 'Invalid artifact' : 'Artefacto inválido'
    );
    await expect(dialog.getByTestId('regression-import-preview')).toHaveCount(0);
    expect(await page.getByTestId('capsule-prepare-regression').count()).toBe(capsuleCount);
    expect(errors).toEqual([]);
  });
}
test('Free cannot prepare a Pro history regression case', async ({ page }) => {
  await seedSession(page, { language: 'en' });
  await gotoApp(page);
  await page.getByTestId('action-pill-browse-capsules').click();
  await expect(page.getByTestId('capsule-regression-dialog')).toHaveCount(0);
  await expect(page.getByTestId('capsule-prepare-regression')).toHaveCount(0);
});
