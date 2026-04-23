/**
 * Locale parity — mirrors a representative slice of the English suites in
 * Spanish to catch missing or wrong i18n keys before users notice. Also
 * covers compact viewport behaviour (390×844, iPhone 14 Pro) and confirms
 * no horizontal overflow under the denser settings form.
 *
 * Keep this file focused on copy + layout invariants. Functional gating
 * is owned by freeTierGates.spec.ts / proTierUnlocks.spec.ts — we only
 * check that the Spanish surface behaves the same way the English one
 * already does.
 */

import {
  applyDevLicense,
  closeSettings,
  createJavaScriptTab,
  expect,
  expectNoHorizontalOverflow,
  expectNoticeContains,
  expectTier,
  gotoApp,
  openCommandPalette,
  openConsole,
  openDeveloperUtilities,
  closeDeveloperUtilities,
  openQuickOpen,
  openSettings,
  openSnippets,
  closeSnippets,
  paletteInput,
  seedSession,
  test,
  waitForRunCompleted,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Spanish locale — shell and settings', () => {
  test('every Settings section heading renders in Spanish', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openSettings(page);

    const headings = [
      'Acerca de',
      'Apariencia',
      'Diseño',
      'Actualizaciones',
      'Editor',
      'Licencia',
      'Privacidad',
      'Variables de entorno',
      'Historial de ejecuciones',
      'Plugins',
    ];
    for (const heading of headings) {
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }

    // Web-honest copy stays localized too.
    await expect(
      page.getByText('Las actualizaciones automáticas no están disponibles en la versión web.')
    ).toBeVisible();
    await expect(page.getByText('No disponible en esta build')).toBeVisible();
  });

  test('upsell notices are localized for theme, font, and history', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openSettings(page);

    await page.getByTestId('theme-pack-select').selectOption('solarized-daylight');
    await expectNoticeContains(page, 'más paquetes de tema');

    await page.getByTestId('editor-font-family-select').selectOption('Menlo, monospace');
    await expectNoticeContains(page, 'más fuentes del editor');

    await page.getByTestId('execution-history-unlock').click();
    await expectNoticeContains(page, 'el historial de ejecuciones y las re-ejecuciones');
  });

  test('command palette placeholder + shortcuts action are localized', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openCommandPalette(page);

    await paletteInput(page).fill('atajos');
    await expect(page.getByRole('button', { name: /Abrir atajos de teclado/i })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('snippets toolbar label is localized and close works', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openSnippets(page);
    await expect(page.getByRole('button', { name: 'Guardar pestaña activa' })).toBeVisible();
    await closeSnippets(page);
  });

  test('quick open "1 archivo" label pluralizes correctly', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await createJavaScriptTab(page);
    await openQuickOpen(page);
    await expect(page.getByText('1 archivo')).toBeVisible();
    await page.keyboard.press('Escape');
  });
});

test.describe('Spanish locale — Pro flows', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'es', primeProLicense: true });
    await gotoApp(page);
    await expectTier(page, 'PRO');
  });

  test('license status pill reads "Activa — Pro" after seeded login', async ({ page }) => {
    await openSettings(page);
    await expect(page.getByTestId('license-status-pill')).toContainText('Activa — Pro');
  });

  test('run completes, history popover is localized, settings shows 1 run recorded', async ({
    page,
  }) => {
    await createJavaScriptTab(page);
    await page.getByRole('button', { name: 'Ejecutar' }).click();
    await waitForRunCompleted(page);

    await openConsole(page);
    await page.getByTestId('execution-history-toggle').click();
    await expect(page.getByTestId('execution-history-popover')).toBeVisible();
    await expect(page.getByTestId('execution-history-entry')).toHaveCount(1);
    await page.keyboard.press('Escape');

    await openSettings(page);
    await expect(page.getByText('1 ejecución registrada')).toBeVisible();
  });

  test('developer utilities modal localizes its title and panel list', async ({ page }) => {
    await openDeveloperUtilities(page);
    await expect(page.getByRole('heading', { name: 'Utilidades integradas' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Formateador JSON' })).toBeVisible();
    await closeDeveloperUtilities(page);
  });

  test('URL Parser localizes its panel copy and empty-state hint', async ({ page }) => {
    await openDeveloperUtilities(page);
    await page.getByRole('button', { name: /^Analizador de URL/ }).click();

    await expect(
      page.getByRole('heading', { level: 3, name: 'Analizador de URL' })
    ).toBeVisible();
    await expect(page.getByText('Parámetros del query')).toBeVisible();

    await page.getByTestId('url-parser-input').fill('');
    await expect(page.getByText('Pega una URL para ver sus partes.')).toBeVisible();

    await closeDeveloperUtilities(page);
  });
});

test.describe('Spanish locale — live apply', () => {
  test('applying the dev license shows "Licencia activada" notice', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openSettings(page);

    await applyDevLicense(page, 'Activa — Pro');
    await expectNoticeContains(page, 'Licencia activada');
    await expectTier(page, 'PRO');
  });
});

test.describe('Compact viewport — 390×844', () => {
  test('Settings form stays within width budget on narrow viewports (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSettings(page);

    await page.setViewportSize({ width: 390, height: 844 });
    // Any deep label confirms Settings actually rendered rather than being
    // clipped away — "Global scope" is the first section of the env-vars
    // table and sits well below the fold on narrow viewports.
    await expect(page.getByText('Global scope')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await closeSettings(page);
  });

  test('Settings form stays within width budget on narrow viewports (ES)', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openSettings(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText('Ámbito global')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await closeSettings(page);
  });

  test('Pro license pill stays legible at 390px width', async ({ page }) => {
    await seedSession(page, { language: 'es', primeProLicense: true });
    await gotoApp(page);
    await expectTier(page, 'PRO');

    await openSettings(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('license-status-pill')).toContainText('Activa — Pro');
    await expectNoHorizontalOverflow(page);
  });
});
