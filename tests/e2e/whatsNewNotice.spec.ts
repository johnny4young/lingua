import { mkdirSync } from 'node:fs';
import {
  APP_VERSION,
  closeSettings,
  dismissWhatsNew,
  expect,
  gotoApp,
  openSettings,
  seedSession,
  test,
} from './licenseWeb.helpers';

const evidenceDir = 'output/review/d4-d5-d7-discoverability';

function captureEnabled(): boolean {
  return process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1';
}

test.describe("internal active What's New notice", () => {
  test('shows one upgrade notice and opens release highlights from its CTA', async ({ page }) => {
    await seedSession(page, { language: 'en', lastSeenVersion: '0.0.0' });
    await gotoApp(page);

    const notice = page.getByTestId('status-notice-banner');
    await expect(notice).toContainText(`Lingua ${APP_VERSION} is ready. See what's new.`);
    await expect(page.locator('.monaco-editor').first()).toBeVisible();

    if (captureEnabled()) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: `${evidenceDir}/d5-web-en-upgrade-notice.png`,
        animations: 'disabled',
      });
    }

    await notice.getByRole('button', { name: "What's New" }).click();
    await expect(page.getByRole('dialog', { name: "What's New", exact: true })).toBeVisible();

    if (captureEnabled()) {
      await page.screenshot({
        path: `${evidenceDir}/d5-web-en-whats-new-overlay.png`,
        animations: 'disabled',
      });
    }

    await dismissWhatsNew(page);
    await page.reload();
    await expect(page.getByText(`Lingua ${APP_VERSION} is ready. See what's new.`)).toHaveCount(0);
  });

  test('persists the Spanish opt-out and acknowledges upgrades silently', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openSettings(page);

    const toggle = page.getByRole('switch', {
      name: 'Mostrar novedades después de actualizar',
    });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.scrollIntoViewIfNeeded();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    if (captureEnabled()) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: `${evidenceDir}/d5-web-es-whats-new-opt-out.png`,
        animations: 'disabled',
      });
    }

    await closeSettings(page);
    await page.evaluate(() => {
      const raw = window.localStorage.getItem('lingua-settings');
      if (!raw) throw new Error('Expected seeded settings');
      const parsed = JSON.parse(raw) as {
        state: { lastSeenVersion?: string };
      };
      parsed.state.lastSeenVersion = '0.0.0';
      window.localStorage.setItem('lingua-settings', JSON.stringify(parsed));
    });
    await page.reload();

    await expect(page.getByText(/está listo\. Revisa las novedades\./i)).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem('lingua-settings');
          if (!raw) return null;
          const parsed = JSON.parse(raw) as {
            state: {
              lastSeenVersion?: string;
              whatsNewNotificationsEnabled?: boolean;
            };
          };
          return {
            lastSeenVersion: parsed.state.lastSeenVersion,
            enabled: parsed.state.whatsNewNotificationsEnabled,
          };
        })
      )
      .toEqual({ lastSeenVersion: APP_VERSION, enabled: false });
  });
});
