/**
 * RL-125 / AUDIT-05 — lazy Developer Utilities panels.
 *
 * Locks the per-tool code-splitting win: opening the workspace on the default
 * (JSON) tool must NOT fetch the heavier QR / SQL panel chunks, and selecting
 * the QR tool must pull its chunk on demand. If a future change re-introduces an
 * eager all-panel registry, the first assertion fails.
 */
import {
  expect,
  expectTier,
  gotoApp,
  openDeveloperUtilities,
  seedSession,
  test,
} from './licenseWeb.helpers';

const HEAVY_PANEL_CHUNK = /(QrCodePanel|SqlFormatterPanel)-[A-Za-z0-9_-]+\.js/;

test.describe('Lazy Developer Utilities panels (RL-125)', () => {
  test('default tool skips heavy panel chunks; selecting QR loads its chunk on demand', async ({
    page,
  }) => {
    const panelChunkRequests: string[] = [];
    page.on('request', request => {
      if (HEAVY_PANEL_CHUNK.test(request.url())) {
        panelChunkRequests.push(new URL(request.url()).pathname);
      }
    });

    // Base Developer Utilities now run on Free; keep this smoke on Pro so
    // the same pass also protects paid utility-workflow side effects.
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await expectTier(page, 'PRO');
    await openDeveloperUtilities(page);

    // The workspace opens on the JSON tool; its panel chunk loads, but the QR and
    // SQL panel chunks must not.
    await expect(page.getByTestId('utility-item-qr-code')).toBeVisible();
    await page.waitForTimeout(750);
    expect(panelChunkRequests).toEqual([]);

    // Selecting QR pulls the QrCodePanel chunk on demand — proving lazy load.
    await page.getByTestId('utility-item-qr-code').click();
    await expect
      .poll(() => panelChunkRequests.some(pathname => /QrCodePanel-/.test(pathname)), {
        timeout: 5000,
      })
      .toBe(true);
  });
});
