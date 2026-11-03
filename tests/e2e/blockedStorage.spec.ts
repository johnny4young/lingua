import type { BrowserContext, Page } from '@playwright/test';
import {
  applyDevLicense,
  clearLicense,
  expect,
  gotoApp,
  openCommandPalette,
  openConsole,
  openSettingsTab,
  paletteInput,
  replaceEditorText,
  test,
} from './licenseWeb.helpers';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const NOTICE = /blocking site data|bloquea los datos de sitios/;
const NOT_SAVED = /not saved|sin guardar/;

// Block-all-cookies makes reading either property throw.
async function blockStorage(target: Page | BrowserContext): Promise<void> {
  await target.addInitScript(() => {
    for (const name of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          throw new DOMException('Access is denied for this document.', 'SecurityError');
        },
      });
    }
  });
}

function trackActivatedDeviceIds(context: BrowserContext): string[] {
  const ids: string[] = [];
  context.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith('/licenses/activate')) {
      ids.push((request.postDataJSON() as { deviceId: string }).deviceId);
    }
  });
  return ids;
}

async function pasteLicense(page: Page): Promise<void> {
  await page.keyboard.press(`${MOD}+,`);
  await openSettingsTab(page, 'account');
  await applyDevLicense(page, /Active|Activa/i);
}

for (const locale of ['en-US', 'es-ES']) {
  test.describe(`with storage blocked (${locale})`, () => {
    test.use({ locale });

    test('boots, runs code and keeps state in memory', async ({ page }) => {
      const dialogs: string[] = [];
      page.on('dialog', dialog => {
        dialogs.push(dialog.type());
        void dialog.accept();
      });
      await blockStorage(page);
      await gotoApp(page);
      await expect(page.locator('html')).toHaveAttribute('data-recovery-state', 'normal');
      await expect(page.locator('html')).toHaveAttribute('data-storage', 'memory');
      await expect(page.getByTestId('status-notice-banner')).toContainText(NOTICE);
      await expect(page.getByTestId('action-pill-autosave')).toContainText(NOT_SAVED);

      await replaceEditorText(page, 'console.log("ran-with-memory-storage");');
      await page.keyboard.press(`${MOD}+Enter`);
      await openConsole(page);
      await expect(
        page.getByTestId('console-entry-row').filter({ hasText: 'ran-with-memory-storage' })
      ).toBeVisible();

      const storedSettings = () =>
        page.evaluate(() => window.localStorage.getItem('lingua-settings'));
      await expect.poll(storedSettings).not.toBeNull();

      await page.evaluate(() => window.localStorage.setItem('blocked-storage-probe', '1'));
      await page.reload();
      await expect(page.getByTestId('license-badge')).toBeVisible();
      expect(dialogs).toEqual(['beforeunload']);
      expect(
        await page.evaluate(() => window.localStorage.getItem('blocked-storage-probe'))
      ).toBeNull();
    });

    test('does not repeat onboarding on each load, and a reload without edits is not stopped', async ({
      page,
    }) => {
      const dialogs: string[] = [];
      page.on('dialog', dialog => {
        dialogs.push(dialog.type());
        void dialog.accept();
      });
      await blockStorage(page);
      await gotoApp(page);
      for (let load = 0; load < 2; load += 1) {
        await expect(page.getByTestId('status-notice-banner')).toContainText(NOTICE);
        // Past the delay before the tour would have started on its own.
        await page.waitForTimeout(800);
        await expect(page.locator('.guided-tour-layer')).toHaveCount(0);
        await expect(page.getByTestId('status-notice-banner')).toContainText(NOTICE);
        await page.reload();
        await expect(page.getByTestId('license-badge')).toBeVisible();
      }
      expect(dialogs).toEqual([]);

      await openCommandPalette(page);
      await paletteInput(page).fill('tour');
      await page.keyboard.press('Enter');
      await expect(page.locator('.guided-tour-step')).toBeVisible();
      await page.keyboard.press('Escape');
    });

    test('keeps one web seat across reloads and tabs', async ({ page, context }) => {
      await blockStorage(context);
      const activated = trackActivatedDeviceIds(context);
      await gotoApp(page);
      await pasteLicense(page);

      await page.reload();
      await expect(page.getByTestId('license-badge')).toContainText('FREE');
      await pasteLicense(page);

      const secondTab = await context.newPage();
      await gotoApp(secondTab);
      await pasteLicense(secondTab);

      expect(activated).toHaveLength(3);
      expect(new Set(activated).size).toBe(1);

      const removed = page.waitForRequest(request => request.url().endsWith('/licenses/devices/remove'));
      await clearLicense(page);
      expect((await removed).postDataJSON().deviceIdToRemove).toBe(activated[0]);
    });

    test('Settings does not claim local storage', async ({ page }) => {
      await blockStorage(page);
      await gotoApp(page);
      await page.keyboard.press(`${MOD}+,`);
      await openSettingsTab(page, 'privacy');
      await expect(page.getByTestId('privacy-trust-section')).toContainText(NOTICE);
    });
  });
}

test('with storage available, autosave and onboarding are unchanged', async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator('.guided-tour-step')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).not.toHaveAttribute('data-storage', 'memory');
  await expect(page.getByTestId('action-pill-autosave')).toContainText('autosave');
  await expect(page.getByTestId('status-notice-banner').filter({ hasText: NOTICE })).toHaveCount(0);
});
