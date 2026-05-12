/**
 * RL-065 Slice 5 fold G — telemetry POST emission gate.
 *
 * Locks the consent + endpoint contract behind CI rather than
 * manual web smoke:
 *
 *   - consent === 'granted' AND a valid endpoint → POST fires for
 *     instrumented actions (Command Palette, app launched, etc.).
 *   - consent === 'declined' → no POST regardless of action.
 *
 * Every POST is intercepted via `page.route` + fulfilled with 204
 * so nothing actually leaves the test runner. The endpoint URL is
 * baked at build time by `playwright.license-web.config.mts` to the
 * production telemetry host because the web CSP only allow-lists that
 * origin for `connect-src`.
 */

import { type Route } from '@playwright/test';
import {
  dismissWhatsNew,
  expect,
  gotoApp,
  openCommandPalette,
  openSettings,
  openSettingsTab,
  seedSession,
  test,
} from './licenseWeb.helpers';

const TELEMETRY_GLOB = '**/updates.linguacode.dev/telemetry';

type CapturedEvent = {
  event: string;
  properties?: Record<string, unknown>;
};

async function installTelemetrySink(
  page: import('@playwright/test').Page
): Promise<CapturedEvent[]> {
  const captured: CapturedEvent[] = [];
  await page.route(TELEMETRY_GLOB, async (route: Route) => {
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
      const body = route.request().postDataJSON() as CapturedEvent;
      captured.push(body);
    } catch {
      captured.push({ event: '<unparseable>' });
    }
    await route.fulfill({
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
  return captured;
}

test.describe('Telemetry consent gate', () => {
  test('consent=declined keeps the emitter silent', async ({ page }) => {
    const captured = await installTelemetrySink(page);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);

    await openCommandPalette(page);
    await page.keyboard.press('Escape');

    // Allow keepalive POSTs to flush before asserting silence.
    await page.waitForTimeout(250);
    expect(captured).toEqual([]);
  });

  test('consent=granted POSTs overlay.opened when the palette is opened', async ({ page }) => {
    const captured = await installTelemetrySink(page);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);

    // Flip telemetry consent to `granted` via the Privacy section.
    await openSettings(page);
    await openSettingsTab(page, 'account');
    const toggle = page.getByRole('switch', {
      name: /share anonymous usage analytics|compartir estadísticas de uso anónimas/i,
    });
    await toggle.click();
    await expect(page.getByTestId('telemetry-status')).toContainText(
      /enabled — thanks for helping improve Lingua|activada — gracias por ayudar a mejorar Lingua/i
    );
    await page.keyboard.press('Escape');

    // Trigger an instrumented action — opening the command palette
    // fires `overlay.opened` from `App.openOverlay`.
    await openCommandPalette(page);
    await page.keyboard.press('Escape');

    // Telemetry uses `keepalive: true`; give the browser a tick to
    // flush before assertion. 500ms is comfortable; the production
    // emitter doesn't batch so this is one POST per fire.
    await page.waitForTimeout(500);

    const overlayOpened = captured.find(
      (entry) => entry.event === 'overlay.opened'
    );
    expect(overlayOpened, `expected overlay.opened POST; captured: ${JSON.stringify(captured)}`).toBeDefined();
    // Positive-shape assertion — the allowlist permits only
    // `overlayId` for this event and the renderer always populates
    // it. A zero-properties POST would still pass the privacy
    // deny-substring scan below, so anchor on the required field.
    expect(typeof overlayOpened?.properties?.overlayId).toBe('string');
    expect(String(overlayOpened?.properties?.overlayId).length).toBeGreaterThan(0);
    // Privacy guard — every captured event must redact away any
    // deny-substring keys. The renderer should never have sent
    // them, but assert at the wire level too.
    for (const entry of captured) {
      const keys = Object.keys(entry.properties ?? {});
      for (const key of keys) {
        const lower = key.toLowerCase();
        expect(lower).not.toContain('source');
        expect(lower).not.toContain('content');
        expect(lower).not.toContain('token');
        expect(lower).not.toContain('email');
        expect(lower).not.toContain('path');
      }
    }
  });

  test('flipping consent back to declined silences subsequent emits', async ({ page }) => {
    const captured = await installTelemetrySink(page);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);

    // Grant first → trigger → expect POST.
    await openSettings(page);
    await openSettingsTab(page, 'account');
    const toggle = page.getByRole('switch', {
      name: /share anonymous usage analytics|compartir estadísticas de uso anónimas/i,
    });
    await toggle.click();
    await expect(page.getByTestId('telemetry-status')).toContainText(
      /enabled — thanks for helping improve Lingua|activada — gracias por ayudar a mejorar Lingua/i
    );
    await page.keyboard.press('Escape');

    await openCommandPalette(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const grantedCount = captured.length;
    expect(grantedCount).toBeGreaterThan(0);

    // Decline → trigger → expect no NEW POST. NB: opening Settings
    // again itself fires `overlay.opened` BEFORE the toggle flips, so
    // we snapshot `captured.length` AFTER the decline takes effect
    // (and after Escape closes the settings overlay) — only then do
    // we trigger the command palette and assert silence.
    await openSettings(page);
    await openSettingsTab(page, 'account');
    await toggle.click();
    await expect(page.getByTestId('telemetry-status')).toContainText(
      /declined — no data leaves|rechazada — ningún dato sale/i
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const beforeDeclinedActions = captured.length;

    await openCommandPalette(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    expect(captured.length).toBe(beforeDeclinedActions);
  });
});
