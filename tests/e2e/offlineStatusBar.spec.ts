import { mkdirSync } from 'node:fs';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

const evidenceDir = 'output/review/internal';

function captureEnabled(): boolean {
  return process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1';
}

function consumeExpectedOfflineResourceErrors(consoleErrors: string[]): void {
  const unexpected = consoleErrors.filter(
    error => error !== 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED'
  );
  expect(unexpected, unexpected.join('\n')).toEqual([]);
  consoleErrors.length = 0;
}

test.describe('internal offline status bar', () => {
  test('celebrates offline operation in English and clears when online', async ({
    context,
    consoleErrors,
    page,
  }) => {
    await seedSession(page, { language: 'en', showStatusBar: true });
    await gotoApp(page);
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    await expect(page.getByTestId('status-bar-offline')).toHaveCount(0);

    // Let the app finish fetching before pulling the plug. Anything still in
    // flight when the network drops fails with ERR_INTERNET_DISCONNECTED and
    // trips the zero-console-error fixture — a failure about test timing, not
    // about the offline contract this test exists to check.
    await page.waitForLoadState('networkidle');
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
    consumeExpectedOfflineResourceErrors(consoleErrors);
  });

  test('renders the positive offline contract in Spanish', async ({
    context,
    consoleErrors,
    page,
  }) => {
    await seedSession(page, { language: 'es', showStatusBar: true });
    await gotoApp(page);
    await expect(page.locator('.monaco-editor').first()).toBeVisible();

    // Same as the English case, and this locale is why it matters: the
    // Spanish catalog is a runtime `import()` (English ships in the initial
    // bundle), so this test has one more request that has to land before the
    // network can go away. It is the only one of the pair that failed on CI.
    await page.waitForLoadState('networkidle');
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
    await expect(page.getByTestId('status-bar-offline')).toHaveCount(0);
    consumeExpectedOfflineResourceErrors(consoleErrors);
  });
});
