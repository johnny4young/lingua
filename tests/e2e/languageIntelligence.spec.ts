/**
 * implementation note — cross-language smoke for the Settings rows.
 *
 * The unit tests cover each row in isolation. This spec verifies the
 * real assembled Settings → Editor panel renders BOTH Rust and Go
 * "unavailable: desktop only" rows on the web build (where the IPC
 * bridge stub returns `'missing': 'web-build'` for both languages),
 * in EN and ES locales, without leaking console errors.
 *
 * Web-only by design: the rows only mount in their `'unavailable'`
 * state when the LSP bridge cannot reach a live launcher, which is
 * exactly what the web build guarantees. A desktop run with both
 * binaries installed would render zero LSP rows here (the toast
 * covers the happy path).
 */

import {
  expect,
  gotoApp,
  openSettings,
  openSettingsTab,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Language intelligence Settings rows (implementation + 4)', () => {
  test('web build surfaces both Rust and Go install hints in English', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSettings(page);
    await openSettingsTab(page, 'languages');

    await expect(
      page.getByText(/Rust language intelligence — desktop only/i)
    ).toBeVisible();
    await expect(
      page.getByText(/rust-analyzer runs as a local subprocess/i)
    ).toBeVisible();
    await expect(page.getByText(/Go language intelligence — desktop only/i)).toBeVisible();
    await expect(page.getByText(/gopls runs as a local subprocess/i)).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test('Spanish locale renders the tuteo install hints for both rows', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openSettings(page);
    await openSettingsTab(page, 'languages');

    await expect(page.getByText(/Inteligencia de Rust — solo escritorio/i)).toBeVisible();
    await expect(page.getByText(/Inteligencia de Go — solo escritorio/i)).toBeVisible();
    await expect(
      page.getByText(
        /gopls corre como subproceso local y no está disponible en la versión web/i
      )
    ).toBeVisible();
  });
});
