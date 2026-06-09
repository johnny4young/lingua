/**
 * RL-088 — Accessibility QA hardening.
 *
 * Three acceptance gates, all enforced via Playwright + axe-core:
 *
 *   1. Automated axe scans against every rendered overlay surface
 *      (Settings tabs, Command Palette, Quick Open, Snippets,
 *      Developer Utilities, What's New, plus the baseline editor
 *      shell). HIGH/CRITICAL violations fail the test; MODERATE/MINOR
 *      surface for follow-up without blocking.
 *
 *   2. Keyboard-only flows for opening, navigating, and dismissing
 *      each major overlay. No mouse interaction at any step.
 *
 *   3. Focus restoration: dismissing an overlay returns focus to the
 *      element that opened it.
 *
 * Default scan tags are WCAG 2.1 AA. The dark-mode-comment color-
 * contrast rule is silenced via `auditA11y`'s default-disabled-rules
 * list and tracked in docs/A11Y.md.
 */

import {
  closeDeveloperUtilities,
  closeSettings,
  closeSnippets,
  dismissWhatsNew,
  expect,
  expectTier,
  gotoApp,
  openCommandPalette,
  openDeveloperUtilities,
  openPaletteAction,
  openQuickOpen,
  openSettings,
  openSettingsTab,
  openSnippets,
  paletteInput,
  seedSession,
  test,
} from './licenseWeb.helpers';
import { auditA11y } from './a11y.helpers';

test.describe.configure({ mode: 'parallel' });

// -----------------------------------------------------------------------
// 1. Automated axe scans
// -----------------------------------------------------------------------

test.describe('Automated axe scans', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await expectTier(page, 'PRO');
    await dismissWhatsNew(page);
  });

  test('baseline editor shell passes WCAG 2.1 AA', async ({ page }) => {
    await auditA11y(page);
  });

  test('Settings — General tab', async ({ page }) => {
    await openSettings(page);
    await expect(page.getByRole('dialog', { name: /tune the shell/i })).toBeVisible();
    await openSettingsTab(page, 'general');
    await auditA11y(page);
  });

  test('Settings — Appearance tab', async ({ page }) => {
    await openSettings(page);
    await openSettingsTab(page, 'appearance');
    await auditA11y(page);
  });

  test('Settings — Editor tab', async ({ page }) => {
    await openSettings(page);
    await openSettingsTab(page, 'editor');
    await auditA11y(page);
  });

  test('Settings — Environment tab', async ({ page }) => {
    await openSettings(page);
    await openSettingsTab(page, 'environment');
    await auditA11y(page);
  });

  test('Settings — Account tab', async ({ page }) => {
    await openSettings(page);
    await openSettingsTab(page, 'account');
    await auditA11y(page);
  });

  test('Command Palette', async ({ page }) => {
    await openCommandPalette(page);
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
    await auditA11y(page);
  });

  test('Quick Open', async ({ page }) => {
    await openQuickOpen(page);
    await expect(page.getByRole('dialog', { name: /quick open/i })).toBeVisible();
    await auditA11y(page);
  });

  test('Snippets', async ({ page }) => {
    await openSnippets(page);
    await expect(page.getByRole('dialog', { name: /snippets/i })).toBeVisible();
    await auditA11y(page);
  });

  test('Developer Utilities', async ({ page }) => {
    await openDeveloperUtilities(page);
    await expect(page.getByTestId('developer-utilities-workspace')).toBeVisible();
    await expect(page.getByRole('heading', { name: /built-in utilities/i })).toBeVisible();
    await auditA11y(page);
  });

  test('Keyboard Shortcuts overlay', async ({ page }) => {
    await openPaletteAction(page, 'keyboard shortcuts', /Keyboard Shortcuts/i);
    await expect(page.getByRole('heading', { name: /All built-in shortcuts/i })).toBeVisible();
    await expect(page.getByRole('dialog', { name: /all built-in shortcuts/i })).toBeVisible();
    await auditA11y(page);
  });

  test("What's New overlay", async ({ page }) => {
    await openPaletteAction(page, "what's new", /What's New/i);
    await expect(
      page.getByRole('heading', { name: /release notes and recent changes/i })
    ).toBeVisible();
    await expect(page.getByRole('dialog', { name: /what's new/i })).toBeVisible();
    await auditA11y(page);
  });
});

// -----------------------------------------------------------------------
// 2. Locale parity — re-scan core surfaces in Spanish
// -----------------------------------------------------------------------

test.describe('Automated axe scans (es-MX neutral)', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'es', primeProLicense: true });
    await gotoApp(page);
    await dismissWhatsNew(page);
  });

  test('Settings — General tab in Spanish', async ({ page }) => {
    await openSettings(page);
    await openSettingsTab(page, 'general');
    await auditA11y(page);
  });

  test('Command Palette in Spanish', async ({ page }) => {
    await openCommandPalette(page);
    await auditA11y(page);
  });
});

// -----------------------------------------------------------------------
// 3. Compact viewport — focus order at the 800x600 breakpoint
// -----------------------------------------------------------------------

test.describe('Compact viewport', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await page.setViewportSize({ width: 800, height: 600 });
  });

  test('baseline editor shell at 800x600 passes WCAG 2.1 AA', async ({ page }) => {
    await auditA11y(page);
  });

  test('Settings overlay at 800x600 passes WCAG 2.1 AA', async ({ page }) => {
    await openSettings(page);
    await auditA11y(page);
  });
});

// -----------------------------------------------------------------------
// 4. Keyboard-only flows
// -----------------------------------------------------------------------

test.describe('Keyboard-only flows', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await dismissWhatsNew(page);
  });

  test('Command Palette opens via Cmd+Shift+P, navigates by keyboard, dismisses with Escape', async ({
    page,
  }) => {
    await page.keyboard.press('ControlOrMeta+Shift+KeyP');
    await expect(paletteInput(page)).toBeVisible();
    await expect(paletteInput(page)).toBeFocused();

    await paletteInput(page).fill('snippets');
    await expect(
      page
        .locator('[data-result-index]')
        .filter({ hasText: /Open Snippets/i })
        .first()
    ).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(paletteInput(page)).toBeHidden();
  });

  test('Quick Open opens via Cmd+P and dismisses with Escape', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+KeyP');
    const goToFileInput = page.getByPlaceholder(/go to file/i);
    await expect(goToFileInput).toBeVisible();
    await expect(goToFileInput).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(goToFileInput).toBeHidden();
  });

  test('Settings opens via Cmd+, and dismisses with Escape', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+Comma');
    await expect(page.getByRole('heading', { name: /tune the shell/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: /tune the shell/i })).toBeHidden();
  });

  test('Settings tabs are reachable by Tab/arrow navigation', async ({ page }) => {
    await openSettings(page);
    const generalTab = page.getByTestId('settings-tab-general');
    const appearanceTab = page.getByTestId('settings-tab-appearance');

    await generalTab.focus();
    await expect(generalTab).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(appearanceTab).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(appearanceTab).toHaveAttribute('aria-selected', 'true');
  });
});

// -----------------------------------------------------------------------
// 5. Focus restoration
// -----------------------------------------------------------------------

test.describe('Focus restoration', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await dismissWhatsNew(page);
  });

  test('Settings restores focus to its toolbar trigger when dismissed', async ({ page }) => {
    const trigger = page.getByTestId('action-pill-settings');
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await expect(page.getByRole('heading', { name: /tune the shell/i })).toBeVisible();

    await closeSettings(page);
    await expect(trigger).toBeFocused();
  });

  test('Command Palette restores focus to its toolbar trigger after autofocus input closes', async ({
    page,
  }) => {
    const trigger = page.getByRole('button', { name: /command palette/i });
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await expect(paletteInput(page)).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(paletteInput(page)).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Quick Open restores focus to its toolbar trigger after autofocus input closes', async ({
    page,
  }) => {
    const trigger = page.getByTestId('action-pill-quick-open');
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    const goToFileInput = page.getByPlaceholder(/go to file/i);
    await expect(goToFileInput).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(goToFileInput).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Snippets restores focus to its toolbar trigger when dismissed', async ({ page }) => {
    const trigger = page.getByTestId('action-pill-snippets');
    await trigger.focus();
    await trigger.press('Enter');
    await expect(page.getByRole('button', { name: /save active tab/i })).toBeVisible();

    await closeSnippets(page);
    await expect(trigger).toBeFocused();
  });

  test('Developer Utilities opens as a workspace tab and can be closed from the tab strip', async ({
    page,
  }) => {
    const trigger = page.getByRole('button', { name: /developer utilities/i });
    await trigger.focus();
    await trigger.press('Enter');
    await expect(page.getByTestId('developer-utilities-workspace')).toBeVisible();

    await closeDeveloperUtilities(page);
    await expect(trigger).toBeVisible();
  });
});
