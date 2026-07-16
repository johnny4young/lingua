import { mkdirSync } from 'node:fs';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

const evidenceDir = 'output/review/it2-g4-g5-resilience';

function captureEnabled(): boolean {
  return process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1';
}

test.describe('IT2-G5 offline status bar', () => {
  test('celebrates offline operation in English and clears when online', async ({
    context,
    page,
  }) => {
    await seedSession(page, { language: 'en', showStatusBar: true });
    await gotoApp(page);
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    await expect(page.getByTestId('status-bar-offline')).toHaveCount(0);

    await context.setOffline(true);
    const offline = page.getByTestId('status-bar-offline');
    await expect(offline).toBeVisible();
    await expect(offline).toContainText('Offline — everything keeps working');
    await expect(offline).toHaveAttribute(
      'title',
      'Offline: local and cached runtimes keep working. Updates, remote AI, and uncached runtime downloads are unavailable.'
    );

    if (captureEnabled()) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: `${evidenceDir}/web-en-offline-status.png`,
      });
    }

    await context.setOffline(false);
    await expect(page.getByTestId('status-bar-offline')).toHaveCount(0);
  });

  test('renders the positive offline contract in Spanish', async ({ context, page }) => {
    await seedSession(page, { language: 'es', showStatusBar: true });
    await gotoApp(page);
    await expect(page.locator('.monaco-editor').first()).toBeVisible();

    await context.setOffline(true);
    const offline = page.getByTestId('status-bar-offline');
    await expect(offline).toBeVisible();
    await expect(offline).toContainText('Sin conexión — todo sigue funcionando');
    await expect(offline).toHaveAttribute(
      'title',
      'Sin conexión: los runtimes locales y almacenados siguen funcionando. Las actualizaciones, la IA remota y las descargas de runtimes no almacenados no están disponibles.'
    );

    if (captureEnabled()) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: `${evidenceDir}/web-es-offline-status.png`,
      });
    }

    await context.setOffline(false);
  });
});
