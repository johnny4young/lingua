import { expect, test, type Page } from '@playwright/test';
import {
  APP_VERSION,
  dismissWhatsNew,
  openCommandPalette,
  openQuickOpen,
  openSettings,
  openSettingsTab,
} from '../e2e/licenseWeb.helpers';

type Theme = 'light' | 'dark';

async function boot(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript(
    ({ version, appTheme }) => {
      if (window.localStorage.getItem('lingua-settings')) return;
      window.localStorage.setItem(
        'lingua-settings',
        JSON.stringify({
          state: {
            language: 'en',
            theme: appTheme,
            editorTheme: appTheme === 'light' ? 'lingua-light' : 'lingua-dark',
            lastSeenVersion: version,
            suppressTourAutoStart: true,
            hasCompletedOnboardingFirstRun: true,
            hasCompletedOnboardingFirstSnippet: true,
            telemetryConsent: 'declined',
            restoreSessionMode: 'never',
          },
          version: 3,
        })
      );
    },
    { version: APP_VERSION, appTheme: theme }
  );
  await page.goto('/');
  await expect(page.getByTestId('license-badge')).toBeVisible();
  await dismissWhatsNew(page);
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`design system · ${theme}`, () => {
    test('workspace empty state', async ({ page }) => {
      await boot(page, theme);
      await page.getByRole('button', { name: /close welcome\.js/i }).click();
      await expect(page.getByTestId('empty-state-quick-start-javascript')).toBeVisible();
      await expect(page).toHaveScreenshot(`workspace-empty-${theme}.png`);
    });

    test('command bar', async ({ page }) => {
      await boot(page, theme);
      await expect(page.getByTestId('command-bar-controls')).toBeVisible();
      await expect(page.getByTestId('app-chrome')).toHaveScreenshot(`command-bar-${theme}.png`);
    });

    // The tab row only: console rows carry wall-clock times and run durations.
    test('results dock tab row', async ({ page }) => {
      await boot(page, theme);
      await expect(page.getByTestId('bottom-panel-console-tab')).toBeVisible();
      const row = page.getByTestId('results-dock').locator('> div').first();
      await expect(row).toHaveScreenshot(`results-dock-${theme}.png`, {
        mask: [page.getByTestId('dock-execution-time'), page.getByTestId('bottom-panel-console-count')],
      });
    });

    test('command palette', async ({ page }) => {
      await boot(page, theme);
      await openCommandPalette(page);
      await expect(page.getByRole('dialog').last()).toHaveScreenshot(`command-palette-${theme}.png`);
    });

    test('quick open', async ({ page }) => {
      await boot(page, theme);
      await openQuickOpen(page);
      await expect(page.getByRole('dialog').last()).toHaveScreenshot(`quick-open-${theme}.png`);
    });

    test('stdin input panel', async ({ page }) => {
      await boot(page, theme);
      await page.keyboard.press('ControlOrMeta+Shift+E');
      await expect(page.getByTestId('stdin-panel')).toBeVisible();
      await expect(page.getByTestId('stdin-panel')).toHaveScreenshot(`stdin-panel-${theme}.png`);
    });

    for (const tab of ['appearance', 'editor', 'recovery'] as const) {
      test(`settings ${tab}`, async ({ page }) => {
        await boot(page, theme);
        await openSettings(page);
        await openSettingsTab(page, tab);
        await expect(page.getByRole('dialog').last()).toHaveScreenshot(`settings-${tab}-${theme}.png`);
      });
    }
  });
}
