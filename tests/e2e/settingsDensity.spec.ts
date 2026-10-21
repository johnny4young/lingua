/**
 * Settings at v4 density: the rail digits follow the rail order, section
 * chips jump to and track sections, and Privacy's Local data clears every
 * audited store behind one confirmation.
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

const RAIL_ORDER = [
  ['1', 'general'],
  ['2', 'appearance'],
  ['3', 'editor'],
  ['4', 'languages'],
  ['5', 'environment'],
  ['6', 'privacy'],
  ['7', 'account'],
  ['8', 'integrations'],
  ['9', 'shortcuts'],
  ['0', 'recovery'],
] as const;

for (const language of ['en', 'es'] as const) {
  test(`Mod+digit opens the Settings tabs in rail order (${language})`, async ({ page }) => {
    await seedSession(page, { language });
    await gotoApp(page);
    await openSettings(page);

    for (const [digit, tab] of RAIL_ORDER) {
      await page.keyboard.press(`ControlOrMeta+${digit}`);
      await expect(page.getByTestId(`settings-tab-${tab}`)).toHaveAttribute(
        'aria-selected',
        'true'
      );
    }
    await expect(page.getByTestId('settings-tab-plugins')).not.toContainText(/\d/);
  });
}

test('Editor section chips jump to a section and follow the scroll', async ({ page }) => {
  await seedSession(page, { language: 'en' });
  await gotoApp(page);
  await openSettings(page);
  await openSettingsTab(page, 'editor');

  const chips = page.getByTestId('settings-section-chip');
  await expect(chips).toHaveText([
    'Editor',
    'Per-language',
    'SQL workspace',
    'Execution history',
    'Developer Utilities',
    'Theme preset',
  ]);
  await expect(chips.first()).toHaveAttribute('aria-current', 'true');

  await page.getByRole('button', { name: 'Per-language', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Per-language defaults' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Per-language', exact: true })).toHaveAttribute(
    'aria-current',
    'true'
  );

  await page.getByRole('combobox', { name: 'Execution timeout · Ruby' }).selectOption('long');
  const stored = await page.evaluate(() => {
    const raw = window.localStorage.getItem('lingua-settings');
    return raw ? JSON.parse(raw).state.runtimeTimeoutPresetByLanguage?.ruby : null;
  });
  expect(stored).toBe('long');
});

test('Local data clears the audited stores after one confirmation', async ({ page }) => {
  await seedSession(page, { language: 'en' });
  await gotoApp(page);
  await page.evaluate(() => {
    window.localStorage.setItem('lingua-snippets', JSON.stringify({ state: { snippets: [] } }));
    window.localStorage.setItem(
      'lingua-workspace-sql-state',
      JSON.stringify({ state: { queries: [], history: [] }, version: 1 })
    );
  });
  await openSettings(page);
  await openSettingsTab(page, 'privacy');

  await page.getByRole('button', { name: 'Local data', exact: true }).click();
  await expect(page.getByTestId('privacy-local-data-total')).toContainText('6 stores');
  await expect(page.getByTestId('privacy-local-data-reveal')).toHaveCount(0);

  await page.getByTestId('privacy-local-data-clear-all').click();
  const dialog = page.getByTestId('privacy-clear-all-modal');
  await expect(dialog).toContainText('lingua-snippets');
  await expect(dialog).toContainText('lingua-workspace-sql-state');
  await expect(dialog).toContainText('notebooks and the open session stay');
  await page.getByTestId('privacy-clear-all-confirm').click();
  await expect(dialog).toHaveCount(0);

  expect(await page.evaluate(() => window.localStorage.getItem('lingua-snippets'))).toBeNull();
  expect(await page.evaluate(() => window.localStorage.getItem('lingua-workspace-sql-state'))).toBeNull();
  await expect(page.getByTestId('privacy-local-stores-size-lingua-snippets')).toHaveText('0 B');
});
