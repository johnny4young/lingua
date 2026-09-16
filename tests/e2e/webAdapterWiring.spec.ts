/**
 * The web adapters take translations, status notices and telemetry from
 * `src/web/main.tsx` instead of importing renderer modules. These specs prove
 * that wiring in the production-shaped web build, where no unit test reaches.
 */

import type { Page, Route } from '@playwright/test';
import {
  dismissWhatsNew,
  expect,
  gotoApp,
  openCommandPalette,
  openSettings,
  openSettingsTab,
  paletteInput,
  seedSession,
  test,
} from './licenseWeb.helpers';

const COPY = {
  en: {
    command: 'Open project folder',
    unsupported: "Your browser does not support opening folders. Use 'Open file…' for now.",
  },
  es: {
    command: 'Abrir carpeta de proyecto',
    unsupported: "Tu navegador no soporta abrir carpetas. Usa 'Abrir archivo…' por ahora.",
  },
} as const;

type CapturedEvent = { event: string; properties?: Record<string, unknown> };

/** Browsers without the File System Access API, such as Safari and Firefox. */
async function removeDirectoryPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: undefined,
      configurable: true,
    });
  });
}

async function openProjectFolder(page: Page, language: 'en' | 'es'): Promise<void> {
  await openCommandPalette(page);
  await paletteInput(page).fill(COPY[language].command);
  await page.getByRole('option', { name: new RegExp(COPY[language].command) }).click();
}

async function captureTelemetry(page: Page): Promise<CapturedEvent[]> {
  const captured: CapturedEvent[] = [];
  await page.route('**/updates.linguacode.dev/telemetry', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
      return;
    }
    try {
      captured.push(route.request().postDataJSON() as CapturedEvent);
    } catch {
      // A non-JSON body must still be fulfilled, or the page request hangs.
      captured.push({ event: '<unparseable>' });
    }
    await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  return captured;
}

for (const language of ['en', 'es'] as const) {
  test(`a browser without the folder picker gets the translated notice (${language})`, async ({
    page,
  }) => {
    await removeDirectoryPicker(page);
    await seedSession(page, { language });
    await gotoApp(page);
    await dismissWhatsNew(page);

    await openProjectFolder(page, language);
    await expect(page.getByTestId('status-notice-banner')).toContainText(
      COPY[language].unsupported
    );
  });
}

test.describe('with a Spanish browser', () => {
  test.use({ locale: 'es-ES' });

  test('choosing the system language follows the browser languages the adapter reports', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await openSettings(page);
    await openSettingsTab(page, 'appearance');

    // Settings resolves System through window.lingua.getSystemLanguages().
    await page.getByTestId('app-language-select').selectOption('system');

    await expect(
      page.getByText('Ajusta el shell, el editor y los valores predeterminados del entorno')
    ).toBeVisible();
    await expect(
      page.getByTestId('app-language-select').locator('option[value="en"]')
    ).toHaveText('Inglés');
  });
});

test('the missing folder picker reaches telemetry once consent is granted', async ({ page }) => {
  const captured = await captureTelemetry(page);
  await removeDirectoryPicker(page);
  await seedSession(page, { language: 'en' });
  await gotoApp(page);
  await dismissWhatsNew(page);

  await openSettings(page);
  await openSettingsTab(page, 'privacy');
  await page.getByRole('switch', { name: /share anonymous usage analytics/i }).click();
  await expect(page.getByTestId('telemetry-status')).toContainText(/enabled/i);
  await page.keyboard.press('Escape');

  await openProjectFolder(page, 'en');
  await expect(page.getByTestId('status-notice-banner')).toContainText(COPY.en.unsupported);
  await openProjectFolder(page, 'en');

  const pickerEvents = () =>
    captured.filter((entry) => entry.event === 'runtime.fs_directory_picker_unsupported');
  await expect.poll(() => pickerEvents().length).toBe(1);
  // Telemetry uses keepalive POSTs; give a second report time to arrive.
  await page.waitForTimeout(500);
  expect(pickerEvents()).toHaveLength(1);
  // Playwright's Chromium reports as Chrome, which supports the picker natively.
  expect(pickerEvents()[0]?.properties).toEqual({ userAgentBucket: 'other' });
});
