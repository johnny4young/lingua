/**
 * Free-tier gates — verifies every Pro-only surface either: (a) is visible
 * with an inert "PRO" affordance that dispatches the upsell notice on
 * interaction, or (b) enforces a hard ceiling (tabs, snippets). Every
 * transition uses the same `pushUpsellNotice` pipeline, so a single notice
 * regression trips multiple tests — which is exactly the early-warning
 * signal we want.
 *
 * These tests never upgrade to Pro mid-flight; any cross-tier flow belongs
 * in proTierUnlocks.spec.ts.
 */

import {
  DEFAULT_FONT_STACK,
  closeSettings,
  createJavaScriptTab,
  dismissNotice,
  expect,
  expectNoticeContains,
  expectTier,
  gotoApp,
  openConsole,
  openSettings,
  openSettingsTab,
  openSnippets,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Free tier gates', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await expectTier(page, 'FREE');
  });

  test('action pill language menu labels Go/Rust as PRO and blocks selection', async ({ page }) => {
    await page.getByTestId('action-pill-lang').click();

    const goItem = page.getByRole('menuitem', { name: /^Go/ });
    const rustItem = page.getByRole('menuitem', { name: /^Rust/ });

    await expect(goItem).toContainText('PRO');
    await expect(rustItem).toContainText('PRO');

    await goItem.click();
    await expectNoticeContains(page, 'additional language runtimes');
    // No Go tab should have been created — the ceiling check fires before
    // the editor store sees the addTab request.
    await expect(page.getByRole('button', { name: /Go .*\.go/i })).toHaveCount(0);
  });

  test('one-tab ceiling upsells on second New JavaScript click', async ({ page }) => {
    await createJavaScriptTab(page);
    await expect(page.getByRole('button', { name: /JS .*\.js/i })).toHaveCount(1);

    await page.getByTestId('action-pill-lang').click();
    await page.getByRole('menuitem', { name: /^JavaScript\b/i }).click();
    await expectNoticeContains(page, 'additional open tabs');
    await expect(page.getByRole('button', { name: /JS .*\.js/i })).toHaveCount(1);
  });

  test('snippet library caps at 5 saved items', async ({ page }) => {
    // Seed already primed 0 snippets. Save one from the default tab, then
    // five more to cross the ceiling — the sixth save must refuse and
    // dispatch the extraSnippets upsell.
    await createJavaScriptTab(page);
    await openSnippets(page);

    async function saveOne() {
      await page.getByRole('button', { name: 'Save Active Tab' }).click();
      await page.getByRole('button', { name: 'Save Snippet' }).click();
    }

    for (let i = 0; i < 5; i += 1) {
      await saveOne();
      await dismissNotice(page);
      await dismissNotice(page);
    }

    // Verify the 5 snippets actually landed in the persisted store first —
    // this protects against silent addSnippet failures falsely passing
    // the next assertion.
    const savedCount = await page.evaluate(() => {
      const raw = window.localStorage.getItem('lingua-snippets');
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { state?: { snippets?: unknown[] } };
      return parsed.state?.snippets?.length ?? 0;
    });
    expect(savedCount).toBe(5);

    // Sixth save attempt: the draft re-renders but the store mutation is
    // a no-op, so the persisted count stays at 5.
    await dismissNotice(page);
    await dismissNotice(page);
    await saveOne();
    await expectNoticeContains(page, 'additional saved snippets');

    const postAttemptCount = await page.evaluate(() => {
      const raw = window.localStorage.getItem('lingua-snippets');
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as { state?: { snippets?: unknown[] } };
      return parsed.state?.snippets?.length ?? 0;
    });
    expect(postAttemptCount).toBe(5);
  });

  test('theme pack selector marks extended packs PRO and reverts on click', async ({ page }) => {
    await openSettings(page);
    await openSettingsTab(page, 'appearance');

    const select = page.getByTestId('theme-pack-select');
    const options = await select.locator('option').allTextContents();

    // "Default" is free; everything else must be labeled PRO.
    expect(options.length).toBeGreaterThan(1);
    const nonDefault = options.filter(option => !/Default/i.test(option));
    expect(nonDefault.every(option => /PRO/i.test(option))).toBe(true);

    await select.selectOption('solarized-daylight');
    await expectNoticeContains(page, 'additional theme packs');
    await expect(select).toHaveValue('default');
  });

  test('editor font family selector marks extended fonts PRO and reverts on click', async ({
    page,
  }) => {
    await openSettings(page);
    await openSettingsTab(page, 'editor');

    const select = page.getByTestId('editor-font-family-select');
    const options = await select.locator('option').allTextContents();
    const nonDefault = options.filter(option => !/Default|JetBrains Mono/i.test(option));
    expect(nonDefault.length).toBeGreaterThan(0);
    expect(nonDefault.every(option => /PRO/i.test(option))).toBe(true);

    await select.selectOption('Menlo, monospace');
    await expectNoticeContains(page, 'additional editor fonts');
    await expect(select).toHaveValue(DEFAULT_FONT_STACK);
  });

  test('execution history Settings row exposes an unlock button (no Clear)', async ({ page }) => {
    await openSettings(page);
    await openSettingsTab(page, 'editor');
    await expect(page.getByTestId('execution-history-unlock')).toBeVisible();
    await expect(page.getByTestId('execution-history-clear')).toHaveCount(0);

    await page.getByTestId('execution-history-unlock').click();
    await expectNoticeContains(page, 'execution history and rerun tools');
  });

  test('execution history popover toggle dispatches upsell instead of opening', async ({
    page,
  }) => {
    // Popover lives in the console header; open the console first.
    await openConsole(page);
    await page.getByTestId('execution-history-toggle').click();
    await expectNoticeContains(page, 'execution history and rerun tools');
    // The popover markup must never render on Free — asserting count=0
    // protects against a regression where the popover opens momentarily
    // before the upsell fires.
    await expect(page.getByTestId('execution-history-popover')).toHaveCount(0);
  });

  test('developer utilities toolbar button opens the free workspace and locks workflows', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Developer utilities' }).click();
    await expect(page.getByTestId('developer-utilities-workspace')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Built-in utilities' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'JSON Formatter' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pretty print' })).toBeVisible();

    await page.getByTestId('utilities-search-input').fill('pipeline');
    await expect(page.getByTestId('utility-lock-utility-pipelines')).toBeVisible();
    await page.getByTestId('utility-item-utility-pipelines').click();
    await expect(page.getByTestId('utility-pipeline-locked')).toBeVisible();
    await expectNoticeContains(page, 'utility workflows');
    await page.getByTestId('utility-pipeline-unlock').click();
    await expectNoticeContains(page, 'utility workflows');
    await expect(page.getByTestId('utility-pipeline-panel')).toHaveCount(0);
  });

  test('developer utilities shortcut opens the free workspace', async ({ page }) => {
    await page.keyboard.press('Control+K');
    await expect(page.getByTestId('developer-utilities-workspace')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'JSON Formatter' })).toBeVisible();
  });

  test('utility pipelines shortcut remains Pro-gated', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+Shift+G');
    await expectNoticeContains(page, 'utility workflows');
    await expect(page.getByTestId('developer-utilities-workspace')).toHaveCount(0);
    await expect(page.getByTestId('utility-pipeline-panel')).toHaveCount(0);
  });

  test('clipboard-on-focus automation is locked in Free settings', async ({ page }) => {
    await openSettings(page);
    await openSettingsTab(page, 'editor');

    const toggle = page.getByRole('switch', {
      name: 'Apply from clipboard on panel focus',
    });
    await expect(toggle).toBeDisabled();
    await expect(page.getByTestId('utilities-clipboard-on-focus-status')).toContainText(
      'Pro automation'
    );

    await page.getByTestId('utilities-clipboard-on-focus-unlock').click();
    await expectNoticeContains(page, 'utility workflows');
  });

  test('license status pill reads "Free plan" and offers no clear affordance', async ({ page }) => {
    await openSettings(page);
    await openSettingsTab(page, 'account');
    await expect(page.getByTestId('license-status-pill')).toContainText('Free plan');
    await expect(page.getByTestId('license-clear')).toHaveCount(0);

    // The apply button must be disabled when the input is empty/whitespace.
    const applyButton = page.getByTestId('license-apply');
    await expect(applyButton).toBeDisabled();
  });

  test('invalid license token surfaces the sanitized error copy', async ({ page }) => {
    await openSettings(page);
    await openSettingsTab(page, 'account');

    await page
      .getByRole('textbox', { name: /paste a license token/i })
      .fill('this.is.not.a.real.token');
    await page.getByTestId('license-apply').click();

    // Sanitized copy — never the raw reason/message from the verifier.
    await expectNoticeContains(page, /that token|license/i);
    // Pill reflects the invalid state explicitly so users know the
    // failure is distinct from plain Free (they did try to apply something).
    await expect(page.getByTestId('license-status-pill')).toContainText('License not recognized');
    // Draft persists so the user can fix it in place.
    await expect(page.getByTestId('license-input')).toHaveValue('this.is.not.a.real.token');
  });

  test('consecutive upsells queue cleanly (theme then font)', async ({ page }) => {
    await openSettings(page);
    await openSettingsTab(page, 'appearance');
    await dismissNotice(page);
    await dismissNotice(page);
    await page.getByTestId('theme-pack-select').selectOption('solarized-daylight');
    await expectNoticeContains(page, 'additional theme packs');
    await dismissNotice(page);
    await dismissNotice(page);

    await openSettingsTab(page, 'editor');
    await page.getByTestId('editor-font-family-select').selectOption('Menlo, monospace');
    await expectNoticeContains(page, 'additional editor fonts');
    await closeSettings(page);
  });
});
