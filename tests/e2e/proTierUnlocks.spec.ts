/**
 * Pro tier unlocks — verifies every Free-tier gate is actually gone once a
 * valid license is applied, and that the Pro-only surfaces (execution
 * history popover, re-run, developer utilities, unlimited tabs/snippets,
 * extra themes/fonts, Go language) actually work.
 *
 * The apply-from-UI flow is exercised once (so we know the Settings →
 * License path holds together). Everything else uses the `primeProLicense`
 * seed to stay fast.
 */

import {
  applyDevLicense,
  clearLicense,
  clickRun,
  createAdditionalJavaScriptTab,
  closeDeveloperUtilities,
  createJavaScriptTab,
  createLanguageTab,
  expect,
  expectTier,
  gotoApp,
  openCommandPalette,
  openConsole,
  openDeveloperUtilities,
  openPaletteAction,
  openSettings,
  openSettingsTab,
  paletteInput,
  seedSession,
  test,
  waitForRunCompleted,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Pro tier unlocks — live apply flow', () => {
  test('applying the dev license flips the badge, the pill, and unblocks paid surfaces', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await expectTier(page, 'FREE');

    await openSettings(page);
    await applyDevLicense(page, 'Active — Monthly');
    await expectTier(page, 'PRO');

    // Paid theme + font should now take effect instead of reverting.
    await openSettingsTab(page, 'appearance');
    await page.getByTestId('theme-pack-select').selectOption('solarized-daylight');
    await expect(page.getByTestId('theme-pack-select')).toHaveValue('solarized-daylight');
    await openSettingsTab(page, 'editor');
    await page.getByTestId('editor-font-family-select').selectOption('Menlo, monospace');
    await expect(page.getByTestId('editor-font-family-select')).toHaveValue('Menlo, monospace');

    // Execution history section swaps from unlock button to clear button.
    await expect(page.getByTestId('execution-history-clear')).toBeVisible();

    // Clear the license and confirm we fall back to Free cleanly.
    await clearLicense(page);
    await expectTier(page, 'FREE');
  });
});

test.describe('Pro tier unlocks — seeded Pro session', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await expectTier(page, 'PRO');
  });

  test('opens every developer utilities panel and shows deterministic output', async ({ page }) => {
    await openDeveloperUtilities(page);

    // Default selection is JSON Formatter — the workspace h2 proves the
    // lazy-loaded panel rendered.
    await expect(
      page.getByRole('heading', { name: 'JSON Formatter', exact: true })
    ).toBeVisible();

    // Sidebar buttons use the `titleLabel` i18n key, so accessible name
    // starts with the utility title (no "Open " prefix).
    await page.getByRole('button', { name: /^Base64 Encoder/ }).click();
    await expect(
      page.getByRole('heading', { name: 'Base64 Encoder', exact: true })
    ).toBeVisible();

    await page.getByRole('button', { name: /^UUID Generator/ }).click();
    await expect(
      page.getByRole('heading', { name: 'UUID Generator', exact: true })
    ).toBeVisible();
    // Interactive probe — proves the panel is live, not just mounted.
    await expect(page.getByTestId('uuid-version-select')).toBeVisible();

    await page.getByRole('button', { name: /^Number Base Converter/ }).click();
    await expect(
      page.getByRole('heading', { name: 'Number Base Converter', exact: true })
    ).toBeVisible();

    await closeDeveloperUtilities(page);
  });

  test('executes a JavaScript run and records it in execution history', async ({ page }) => {
    await createJavaScriptTab(page);
    await clickRun(page);
    await waitForRunCompleted(page);

    await openConsole(page);
    await page.getByTestId('execution-history-toggle').click();
    await expect(page.getByTestId('execution-history-popover')).toBeVisible();
    await expect(page.getByTestId('execution-history-entry')).toHaveCount(1);
    await expect(page.getByTestId('execution-history-rerun')).toBeVisible();

    await page.keyboard.press('Escape');

    // Settings surface must reflect the same count; this protects against
    // a regression where the store and the settings section drift out of
    // sync (different selectors, different memoization).
    await openSettings(page);
    await openSettingsTab(page, 'editor');
    await expect(page.getByText('1 run recorded')).toBeVisible();
  });

  test('command palette exposes the rerun-last action after a run lands', async ({ page }) => {
    await createJavaScriptTab(page);
    await clickRun(page);
    await waitForRunCompleted(page);

    await openCommandPalette(page);
    // Rerun surfaces in the palette under its "Recent:" label (language +
    // status + duration). It's a Pro-only command — on Free the command
    // is absent, not merely disabled.
    await expect(
      page.getByRole('option', { name: /Recent: JavaScript · ok · .* ms/i })
    ).toBeVisible();
    await expect(page.getByRole('option', { name: /Re-run last execution/i })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('unlimited tab creation beyond the Free ceiling', async ({ page }) => {
    await createJavaScriptTab(page);
    await createAdditionalJavaScriptTab(page);
    await createAdditionalJavaScriptTab(page);

    await expect(page.getByRole('button', { name: /JS .*\.js/i })).toHaveCount(3);
  });

  test('Go language is selectable as a tab but Run stays disabled in web build', async ({
    page,
  }) => {
    await page.getByTestId('action-pill-lang').click();
    // On Pro, the Go menu item shows "Desktop only" rather than "PRO".
    await expect(page.getByRole('menuitem', { name: /^Go/ })).toContainText('Desktop only');
    await page.keyboard.press('Escape');
    await createLanguageTab(page, /^Go\b/i, /Go .*\.go/i);
    await expect(page.getByRole('button', { name: /Go .*\.go/i })).toBeVisible();

    // The Run button remains disabled with the desktop-only tooltip.
    await expect(page.getByTestId('action-pill-run')).toBeDisabled();
  });

  test('keyboard-shortcuts palette action opens the full shortcuts modal', async ({ page }) => {
    await openPaletteAction(page, 'keyboard', /Open Keyboard Shortcuts/i);
    await expect(page.getByTestId('keyboard-shortcuts-modal')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'All built-in shortcuts', exact: true })
    ).toBeVisible();

    // The preset selector is the Pro-exclusive bit of this modal.
    await expect(page.getByTestId('shortcut-preset-select')).toBeVisible();

    await page.getByRole('button', { name: /close keyboard shortcuts/i }).click();
    await expect(page.getByTestId('keyboard-shortcuts-modal')).toBeHidden();
  });

  test('palette routes to overlays without breaking the stack', async ({ page }) => {
    // search-in-files → project search overlay
    await openPaletteAction(page, 'search in files', /Search in Files/i);
    await expect(page.getByPlaceholder('Search across the project...')).toBeVisible();
    await expect(page.getByText('Open a project to search across its files.')).toBeVisible();
    await page.keyboard.press('Escape');

    // go-to-symbol → requires an active tab
    await createJavaScriptTab(page);
    await openPaletteAction(page, 'symbol', /Go to Symbol in File/i);
    await expect(page.getByPlaceholder('Jump to symbol in this file...')).toBeVisible();
    await page.keyboard.press('Escape');

    // Palette stays closed after Escape — the close should not bounce
    // back into another overlay (regression guard for a past stack bug).
    await expect(paletteInput(page)).toBeHidden();
  });
});
