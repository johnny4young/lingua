import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { dispatch } from '../../src/cli/lingua';
import { createFakeIo } from '../cli/io-fake';
import {
  createJavaScriptTab,
  dismissWhatsNew,
  expect,
  gotoApp,
  openConsole,
  openSettings,
  openSettingsTab,
  seedSession,
  test,
} from './licenseWeb.helpers';

async function replaceEditorText(page: Page, source: string): Promise<void> {
  await page
    .locator('.monaco-editor')
    .first()
    .click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(source);
}

for (const language of ['en', 'es'] as const) {
  test(`edit, fail, recover, export and replay evidence (${language})`, async ({ page }) => {
    await seedSession(page, {
      language,
      workflowModeDefaultsByLanguage: { javascript: 'run' },
    });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await openConsole(page);
    const run = page.getByTestId('action-pill-run');
    const rows = page.getByTestId('console-entry-row');

    await replaceEditorText(page, 'console.log("journey-first")');
    await run.click();
    await expect(rows.filter({ hasText: 'journey-first' })).toHaveCount(1);
    await expect(run).toHaveAttribute('data-running', 'false');

    await replaceEditorText(page, 'throw new Error("journey-failure")');
    await run.click();
    await expect(rows.filter({ hasText: 'journey-failure' })).toHaveCount(1);
    await expect(
      rows.filter({ hasText: language === 'en' ? 'Failed in' : 'Falló en' })
    ).toHaveCount(1);
    await expect(run).toHaveAttribute('data-running', 'false');

    await replaceEditorText(page, 'console.log(3)');
    await run.click();
    await expect(rows.filter({ has: page.getByText('3', { exact: true }) })).toHaveCount(1);
    await expect(
      rows.filter({ hasText: language === 'en' ? 'Completed in' : 'Completado en' })
    ).toHaveCount(1);
    await expect(run).toHaveAttribute('data-running', 'false');

    await openSettings(page);
    await openSettingsTab(page, 'account');
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('capsule-save-json-button').click();
    const download = await downloadPromise;
    const downloadedPath = await download.path();
    if (!downloadedPath) throw new Error('Capsule download path is missing');
    const capsuleText = readFileSync(downloadedPath, 'utf8');
    const capsule = JSON.parse(capsuleText) as {
      version: number;
      source: { content: string };
      result: { stdout?: string };
    };
    expect(capsule.version).toBe(1);
    expect(capsule.source.content).toBe('console.log(3)');
    expect(capsule.result.stdout).toBe('3\n');

    const validation = createFakeIo({ files: { [downloadedPath]: capsuleText } });
    expect(await dispatch(['capsule', 'validate', downloadedPath, '--json'], validation.io)).toBe(
      0
    );
    expect(JSON.parse(validation.state.stdout)).toMatchObject({ ok: true });
    expect(validation.state.stderr).toBe('');

    const replay = createFakeIo({ files: { [downloadedPath]: capsuleText } });
    expect(await dispatch(['capsule', 'replay', downloadedPath, '--json'], replay.io)).toBe(0);
    expect(JSON.parse(replay.state.stdout)).toMatchObject({
      ok: true,
      comparison: { matches: true, stdout: true },
      run: { status: 'success', stdout: '3\n' },
    });
    expect(replay.state.stderr).toBe('');

    await page.screenshot({ path: test.info().outputPath(`evidence-journey-${language}.png`) });
  });
}
