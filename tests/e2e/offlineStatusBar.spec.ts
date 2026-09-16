import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

const evidenceDir = 'output/review/internal';

function captureEnabled(): boolean {
  return process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1';
}

/**
 * Going offline mid-startup is outside the offline contract: the service
 * worker precaches only the app shell, so a chunk the app has not fetched yet
 * fails without a network in production too. `networkidle` does not mark the
 * end of startup, though. Its 500 ms quiet window can close before the app's
 * late loads start (Monaco's workers, the magic-comment providers, the inline
 * results overlay), and cutting the network then makes Monaco reject with a
 * raw `Event` that the zero-console-error fixture reports. So the tests wait
 * for those loads and for a longer quiet window with nothing in flight.
 */
const STARTUP_LATE_LOADS = [
  /\/editor\.worker-[^/]+\.js$/,
  /\/ts\.worker-[^/]+\.js$/,
  /\/magicCommentProviders-[^/]+\.js$/,
  /\/InlineResultWidgets-[^/]+\.js$/,
];
const STARTUP_QUIET_MS = 1_000;

interface NetworkActivity {
  finished: string[];
  inFlight: () => number;
  quietForMs: () => number;
}

function trackNetworkActivity(page: Page): NetworkActivity {
  const finished: string[] = [];
  let inFlight = 0;
  let lastChangeAt = Date.now();
  const settle = () => {
    inFlight = Math.max(0, inFlight - 1);
    lastChangeAt = Date.now();
  };
  page.on('request', () => {
    inFlight += 1;
    lastChangeAt = Date.now();
  });
  page.on('requestfinished', request => {
    finished.push(request.url());
    settle();
  });
  page.on('requestfailed', settle);
  return { finished, inFlight: () => inFlight, quietForMs: () => Date.now() - lastChangeAt };
}

async function waitForStartupSettled(activity: NetworkActivity): Promise<void> {
  await expect
    .poll(
      () =>
        STARTUP_LATE_LOADS.filter(
          pattern => !activity.finished.some(url => pattern.test(url))
        ).map(String),
      { message: 'startup late loads still pending before going offline' }
    )
    .toEqual([]);
  await expect
    .poll(() => activity.inFlight() === 0 && activity.quietForMs() >= STARTUP_QUIET_MS, {
      message: 'network still busy before going offline',
    })
    .toBe(true);
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
    const activity = trackNetworkActivity(page);
    await seedSession(page, { language: 'en', showStatusBar: true });
    await gotoApp(page);
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    await expect(page.getByTestId('status-bar-offline')).toHaveCount(0);

    // Let the app finish fetching before pulling the plug. Anything still in
    // flight when the network drops fails with ERR_INTERNET_DISCONNECTED and
    // trips the zero-console-error fixture — a failure about test timing, not
    // about the offline contract this test exists to check.
    await waitForStartupSettled(activity);
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
    const activity = trackNetworkActivity(page);
    await seedSession(page, { language: 'es', showStatusBar: true });
    await gotoApp(page);
    await expect(page.locator('.monaco-editor').first()).toBeVisible();

    // Same as the English case. The Spanish catalog is a runtime `import()`
    // (English ships in the initial bundle), which delays startup, so the late
    // loads land closest to the network cut here; this is the case that
    // failed on CI.
    await waitForStartupSettled(activity);
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
