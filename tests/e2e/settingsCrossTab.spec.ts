/**
 * Two tabs of the web build share `lingua-settings`: a revocation in one reaches
 * the other and survives that tab's next settings write. Runs in both locales
 * and reads state from controls, so it does not depend on copy.
 */

import type { Page } from '@playwright/test';
import {
  expect,
  gotoApp,
  openSettings,
  openSettingsTab,
  seedSession,
  test,
  trackConsoleErrors,
} from './licenseWeb.helpers';

function telemetrySwitch(page: Page) {
  return page.getByTestId('telemetry-status').locator('..').getByRole('switch');
}

async function openPrivacy(page: Page): Promise<void> {
  await openSettings(page);
  await openSettingsTab(page, 'privacy');
}

function storedSettings(page: Page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem('lingua-settings');
    return raw ? (JSON.parse(raw) as { state: Record<string, unknown> }).state : null;
  });
}

async function writeSettingFrom(page: Page): Promise<void> {
  await openSettingsTab(page, 'editor');
  await page.getByTestId('settings-notebook-default-language').selectOption('typescript');
}

async function openSecondTab(page: Page) {
  const other = await page.context().newPage();
  const errors = trackConsoleErrors(other);
  await gotoApp(other);
  await openPrivacy(other);
  return { other, otherErrors: errors };
}

async function countSettingsEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as { settingsEvents: number };
    target.settingsEvents = 0;
    window.addEventListener('storage', event => {
      if (event.key === 'lingua-settings') target.settingsEvents += 1;
    });
  });
}

function settingsEvents(page: Page) {
  return page.evaluate(() => (window as unknown as { settingsEvents: number }).settingsEvents);
}

for (const language of ['en', 'es'] as const) {
  test.describe(`Settings across tabs (${language})`, () => {
    test('a revocation reaches the other tab and survives its next write', async ({ page }) => {
      await seedSession(page, { language });
      await gotoApp(page);
      await openPrivacy(page);
      await telemetrySwitch(page).click();
      await expect(telemetrySwitch(page)).toHaveAttribute('aria-checked', 'true');

      const { other, otherErrors } = await openSecondTab(page);
      await expect(telemetrySwitch(other)).toHaveAttribute('aria-checked', 'true');
      await countSettingsEvents(page);
      await countSettingsEvents(other);

      await telemetrySwitch(page).click();
      await expect(telemetrySwitch(other)).toHaveAttribute('aria-checked', 'false');

      await writeSettingFrom(other);
      await expect
        .poll(() => storedSettings(other))
        .toMatchObject({ telemetryConsent: 'declined', notebookDefaultCellLanguage: 'typescript' });

      // The first tab picks up the second tab's write and keeps its own revocation.
      await expect(telemetrySwitch(page)).toHaveAttribute('aria-checked', 'false');
      await openSettingsTab(page, 'editor');
      await expect(page.getByTestId('settings-notebook-default-language')).toHaveValue(
        'typescript'
      );

      // Neither tab answers the other's event with a write of its own.
      const settled = [await settingsEvents(page), await settingsEvents(other)];
      await page.waitForTimeout(1000);
      expect([await settingsEvents(page), await settingsEvents(other)]).toEqual(settled);
      expect(otherErrors).toEqual([]);
    });

    test('clearing settings in one tab also clears the other', async ({ page }) => {
      await seedSession(page, { language });
      await gotoApp(page);
      await openPrivacy(page);
      await telemetrySwitch(page).click();
      await expect(telemetrySwitch(page)).toHaveAttribute('aria-checked', 'true');

      const { other, otherErrors } = await openSecondTab(page);
      await expect(telemetrySwitch(other)).toHaveAttribute('aria-checked', 'true');

      await page.getByTestId('privacy-local-stores-clear-lingua-settings').click();
      await page.getByTestId('privacy-clear-confirm-confirm').click();
      await expect(telemetrySwitch(other)).toHaveAttribute('aria-checked', 'false');

      await writeSettingFrom(other);
      await expect
        .poll(() => storedSettings(other))
        .toMatchObject({ telemetryConsent: 'unset', notebookDefaultCellLanguage: 'typescript' });
      expect(otherErrors).toEqual([]);
    });

    test('clearing all storage in one tab resets the other', async ({ page }) => {
      await seedSession(page, { language });
      await gotoApp(page);
      await openPrivacy(page);
      await telemetrySwitch(page).click();
      await expect(telemetrySwitch(page)).toHaveAttribute('aria-checked', 'true');

      const { other, otherErrors } = await openSecondTab(page);
      await expect(telemetrySwitch(other)).toHaveAttribute('aria-checked', 'true');

      await page.evaluate(() => window.localStorage.clear());
      await expect(telemetrySwitch(other)).toHaveAttribute('aria-checked', 'false');

      await writeSettingFrom(other);
      await expect
        .poll(() => storedSettings(other))
        .toMatchObject({ telemetryConsent: 'unset', notebookDefaultCellLanguage: 'typescript' });
      expect(otherErrors).toEqual([]);
    });
  });
}
