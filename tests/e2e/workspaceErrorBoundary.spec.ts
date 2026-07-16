import { mkdirSync } from 'node:fs';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

const evidenceDir = 'output/review/it2-g6-g7-product-hardening';

declare global {
  interface Window {
    __linguaE2e?: {
      armWorkspaceCrash: (region: 'notebook' | 'sql' | 'http' | 'utilities') => void;
    };
  }
}

function captureEnabled(): boolean {
  return process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1';
}

async function armNotebookCrash(page: import('@playwright/test').Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => Boolean(window.__linguaE2e))).toBe(true);
  await page.evaluate(() => window.__linguaE2e?.armWorkspaceCrash('notebook'));
}

test.describe('IT2-G6 regional workspace error boundary', () => {
  test('contains a notebook render crash, copies its region, and retries locally in English', async ({
    context,
    page,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await armNotebookCrash(page);

    await page.keyboard.press('ControlOrMeta+Alt+N');
    const fallback = page.getByTestId('error-boundary-notebook');
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText('This panel crashed while rendering');
    await expect(fallback).toContainText('Error · the notebook workspace');

    const paletteTrigger = page.getByRole('button', { name: /command palette/i });
    await expect(paletteTrigger).toBeEnabled();
    await paletteTrigger.click();
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(fallback).toBeVisible();

    await page.getByTestId('error-boundary-notebook-copy').click();
    await expect(page.getByTestId('error-boundary-notebook-copy')).toContainText(
      'Copied to clipboard'
    );
    const report = await page.evaluate(() => navigator.clipboard.readText());
    expect(report).toContain('"region": "notebook"');

    if (captureEnabled()) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: `${evidenceDir}/g6-web-en-notebook-boundary.png`,
      });
    }

    await page.getByTestId('error-boundary-notebook-retry').click();
    await expect(page.getByTestId('notebook-view')).toBeVisible();
    await expect(fallback).toHaveCount(0);
    await expect(paletteTrigger).toBeEnabled();
  });

  test('renders the compact recovery contract in Spanish and restores the notebook', async ({
    page,
  }) => {
    await seedSession(page, { language: 'es', primeProLicense: true });
    await gotoApp(page);
    await armNotebookCrash(page);

    await page.keyboard.press('ControlOrMeta+Alt+N');
    const fallback = page.getByTestId('error-boundary-notebook');
    await expect(fallback).toContainText('Error · el espacio de notebooks');
    await expect(fallback).toContainText('El resto de la app sigue funcionando');
    await expect(page.getByTestId('error-boundary-notebook-retry')).toContainText('Reintentar');

    await page.getByTestId('error-boundary-notebook-retry').click();
    await expect(page.getByTestId('notebook-view')).toBeVisible();
    await expect(fallback).toHaveCount(0);

    if (captureEnabled()) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: `${evidenceDir}/g6-web-es-notebook-recovered.png`,
      });
    }
  });
});
