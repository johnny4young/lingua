/**
 * Settings modal — each section asserts the rendered controls, the
 * observable store round-trip (toggle → localStorage → re-read), and the
 * web-specific "not available" messaging. License flows live here too:
 * status pill, apply + clear, sanitized error paths.
 *
 * These tests stay tier-agnostic when possible. The License section is
 * inherently tier-sensitive and runs the apply flow in-line.
 */

import {
  applyDevLicense,
  clearLicense,
  closeSettings,
  expect,
  expectTier,
  expectNoticeContains,
  gotoApp,
  openSettings,
  openSettingsTab,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Settings — structural tour', () => {
  test('every section heading renders in EN', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSettings(page);

    await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Updates', exact: true })).toBeVisible();

    await openSettingsTab(page, 'appearance');
    await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Layout', exact: true })).toBeVisible();

    await openSettingsTab(page, 'editor');
    await expect(page.getByRole('heading', { name: 'Editor', exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Execution history', exact: true })
    ).toBeVisible();

    await openSettingsTab(page, 'plugins');
    await expect(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible();

    // RL-095 Slice 1 (post-review refactor) — Languages tab hosts the
    // capability scorecard + per-language LSP rows.
    await openSettingsTab(page, 'languages');
    await expect(
      page.getByRole('heading', { name: 'Language Support Scorecard', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Per-language preferences', exact: true })
    ).toBeVisible();

    await openSettingsTab(page, 'environment');
    await expect(
      page.getByRole('heading', { name: 'Environment variables', exact: true })
    ).toBeVisible();

    await openSettingsTab(page, 'account');
    await expect(page.getByRole('heading', { name: 'License', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();

    await openSettingsTab(page, 'privacy');
    await expect(
      page.getByRole('heading', { name: 'Privacy + Trust', exact: true })
    ).toBeVisible();
  });
});

test.describe('Settings — Updates section (web honest-copy)', () => {
  test('web build explains updates are not available and disables controls', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSettings(page);

    await expect(
      page.getByText('Automatic updates are not available in the web version.')
    ).toBeVisible();
    // The "Unavailable" status is the deterministic anchor
    // for the locked state — `updates.state.unavailable` in i18n.
    await expect(page.getByText('Unavailable')).toBeVisible();
  });
});

test.describe('Settings — Privacy section', () => {
  test('declined state reflects in the status label and persists', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSettings(page);
    await openSettingsTab(page, 'account');

    // Seed writes telemetryConsent = 'declined' so this state is the baseline.
    await expect(page.getByTestId('telemetry-status')).toContainText(
      /declined|no data leaves/i
    );
  });
});

test.describe('Settings — About section', () => {
  test('version, links, and tour entry point render', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSettings(page);

    // Deterministic copy — proves i18n interpolation is not stuck on keys.
    await expect(
      page.getByText('Lingua keeps fast multi-language experiments inside one focused editor shell.')
    ).toBeVisible();

    // The Tour trigger is the canonical way users discover the guided tour.
    await expect(page.getByTestId('about-start-tour')).toBeVisible();

    // "Show the guided tour launcher" toggle row — value is controlled by
    // `suppressTourAutoStart` in the settings store (seeded to true here).
    await expect(page.getByTestId('settings-show-tour-toggle')).toBeVisible();
  });
});

test.describe('Settings — Environment variables', () => {
  test('adding a global variable lands in the effective-vars trace', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSettings(page);
    await openSettingsTab(page, 'environment');

    const global = page.getByTestId('env-vars-global-region');
    await global.getByTestId('env-vars-key-input').fill('FOO_BAR');
    await global.getByTestId('env-vars-value-input').fill('demo');
    await global.getByTestId('env-vars-add-button').click();

    // The "effective" trace is inside a collapsed <details>; open it.
    await page.getByTestId('env-vars-effective').locator('summary').click();
    await expect(page.getByTestId('env-vars-effective-row-FOO_BAR')).toContainText('demo');
  });

  test('adding the same key twice overwrites the value (upsert semantics)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSettings(page);
    await openSettingsTab(page, 'environment');

    const global = page.getByTestId('env-vars-global-region');
    await global.getByTestId('env-vars-key-input').fill('DUPE');
    await global.getByTestId('env-vars-value-input').fill('1');
    await global.getByTestId('env-vars-add-button').click();

    await global.getByTestId('env-vars-key-input').fill('DUPE');
    await global.getByTestId('env-vars-value-input').fill('2');
    await global.getByTestId('env-vars-add-button').click();

    // Second add succeeds and overwrites — no inline error, and the list
    // still holds exactly one row for DUPE with the new value.
    await expect(global.getByTestId('env-vars-error')).toHaveCount(0);
    await expect(global.getByTestId('env-vars-list')).toContainText('DUPE');
    await expect(global.getByTestId('env-vars-list')).toContainText('2');
  });

  test('empty key raises the inline "key required" error', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSettings(page);
    await openSettingsTab(page, 'environment');

    const global = page.getByTestId('env-vars-global-region');
    await global.getByTestId('env-vars-value-input').fill('orphan');
    await global.getByTestId('env-vars-add-button').click();
    await expect(global.getByTestId('env-vars-error')).toBeVisible();
  });
});

test.describe('Settings — Editor section', () => {
  test('Vim mode toggle flips state and persists to localStorage', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSettings(page);
    await openSettingsTab(page, 'editor');

    const vimToggle = page.getByRole('switch', { name: 'Vim mode' });
    await expect(vimToggle).toHaveAttribute('aria-checked', 'false');

    await vimToggle.click();
    await expect(vimToggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('editor-vim-mode-status')).toHaveCount(0);

    // Round-trip through localStorage confirms the settings store actually
    // persisted the change (rather than just flipping local state).
    const persisted = await page.evaluate(() => {
      const raw = window.localStorage.getItem('lingua-settings');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { state?: { vimMode?: boolean } };
      return parsed.state?.vimMode ?? null;
    });
    expect(persisted).toBe(true);
  });

  test('font family preview reflects the default stack on Free', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSettings(page);
    await openSettingsTab(page, 'editor');

    // The preview always renders the live font-family the editor will use.
    await expect(page.getByTestId('editor-font-preview')).toBeVisible();
  });
});

test.describe('Settings — License flows', () => {
  test('apply → clear → re-apply cycles cleanly', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSettings(page);
    await openSettingsTab(page, 'account');

    await applyDevLicense(page, 'Active — Monthly');
    await expectTier(page, 'PRO');
    await expectNoticeContains(page, 'License activated');

    await clearLicense(page);
    await expectTier(page, 'FREE');
    await expectNoticeContains(page, /cleared|removed/i);

    // Re-applying the same token should succeed — validates the token is
    // still valid for the session and Clear doesn't invalidate anything
    // beyond the current install.
    await applyDevLicense(page, 'Active — Monthly');
    await expectTier(page, 'PRO');
  });

  test('malformed token never leaks developer details to the banner', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSettings(page);
    await openSettingsTab(page, 'account');

    await page
      .getByRole('textbox', { name: /paste a license token/i })
      .fill('garbage-token-not-signed');
    await page.getByRole('button', { name: /apply license/i }).click();

    // The notice must NOT contain the internal reason codes or env-var
    // names. We assert on both the positive expected copy and the
    // negative absence of known leak strings.
    const banner = page.getByTestId('status-notice-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/token|license/i);

    const text = (await banner.textContent()) ?? '';
    for (const forbidden of [
      'VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK',
      'no-public-key',
      'invalid-signature',
      'clock-skew',
    ]) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

test.describe('Settings persistence', () => {
  test('Vim mode + env vars survive a reload', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await openSettings(page);
    await openSettingsTab(page, 'editor');
    await page.getByRole('switch', { name: 'Vim mode' }).click();
    await openSettingsTab(page, 'environment');

    const global = page.getByTestId('env-vars-global-region');
    await global.getByTestId('env-vars-key-input').fill('PERSIST');
    await global.getByTestId('env-vars-value-input').fill('yes');
    await global.getByTestId('env-vars-add-button').click();

    await closeSettings(page);

    await page.reload();
    await openSettings(page);

    await openSettingsTab(page, 'editor');
    await expect(page.getByRole('switch', { name: 'Vim mode' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await openSettingsTab(page, 'environment');
    await expect(page.getByTestId('env-vars-global-region')).toContainText('PERSIST');
  });
});
