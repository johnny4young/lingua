/**
 * Network from running code (Labs flag): Block refuses a user fetch in the JS
 * worker, Ask confirms a host once per tab, and with the flag off nothing changes.
 */

import type { Page } from '@playwright/test';
import {
  closeSettings,
  expect,
  gotoApp,
  openConsole,
  openSettings,
  openSettingsTab,
  replaceEditorAndWaitForAutoRun,
  seedSession,
  test,
  waitForSeededWorkspaceSettled,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

const HOST = 'network-policy.example';

/** Counts requests that reach the (mocked) host. */
async function routeHost(page: Page): Promise<string[]> {
  const hits: string[] = [];
  await page.route(`https://${HOST}/**`, route => {
    hits.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  return hits;
}

// One line: Scratchpad instruments line by line, and a brace plus newline auto-closes in Monaco.
const fetchSource = (marker: string) =>
  `try { const response = await fetch('https://${HOST}/data'); console.log('${marker}', 'status', response.status); } catch (error) { console.log('${marker}', 'failed', error.message); }`;

async function choosePolicy(page: Page, option: 'allow' | 'ask' | 'block'): Promise<void> {
  await openSettings(page);
  await openSettingsTab(page, 'labs');
  const flag = page.getByTestId('labs-flag-networkPolicy');
  if ((await flag.getAttribute('aria-checked')) !== 'true') await flag.click();
  await openSettingsTab(page, 'privacy');
  await page.getByTestId(`privacy-network-policy-${option}`).click();
  await expect(page.getByTestId(`privacy-network-policy-${option}`)).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await closeSettings(page);
}

async function boot(page: Page, language: 'en' | 'es' = 'en'): Promise<void> {
  await seedSession(page, { language });
  await gotoApp(page);
  await waitForSeededWorkspaceSettled(page);
  await openConsole(page);
}

test('Block refuses a user fetch in the JS worker and logs it', async ({ page }) => {
  const hits = await routeHost(page);
  await boot(page);
  await choosePolicy(page, 'block');

  await replaceEditorAndWaitForAutoRun(page, fetchSource('blockmarker'), 'blockmarker');
  await expect(
    page.getByTestId('console-entry-row').filter({ hasText: 'blockmarker' }).first()
  ).toContainText(`blocked a network request to ${HOST}`);
  expect(hits).toEqual([]);

  await openSettings(page);
  await openSettingsTab(page, 'privacy');
  await expect(page.getByTestId('privacy-recent-list')).toContainText('Running code');
});

test('Ask confirms a host once per tab and then lets it through', async ({ page }) => {
  const hits = await routeHost(page);
  await boot(page);
  await choosePolicy(page, 'ask');

  await page.locator('.monaco-editor').first().click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(fetchSource('askmarker'));
  const dialog = page.getByTestId('network-ask-dialog');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('network-ask-host')).toHaveText(HOST);
  await page.getByTestId('network-ask-allow').click();
  await expect(
    page.getByTestId('console-entry-row').filter({ hasText: 'askmarker' }).first()
  ).toContainText(/status"?\s*200/, { timeout: 30_000 });

  // The answer holds for the tab: the next run does not ask again.
  await replaceEditorAndWaitForAutoRun(page, fetchSource('againmarker'), 'againmarker');
  await expect(dialog).toHaveCount(0);
  expect(hits.length).toBeGreaterThanOrEqual(2);
});

test('with the Labs flag off, Privacy has no network row and fetch is unchanged', async ({
  page,
}) => {
  const hits = await routeHost(page);
  await boot(page);
  await openSettings(page);
  await openSettingsTab(page, 'privacy');
  await expect(page.getByTestId('privacy-network-policy')).toHaveCount(0);
  await expect(page.getByTestId('privacy-ai-source')).toHaveText('Not configured');
  await closeSettings(page);

  await replaceEditorAndWaitForAutoRun(page, fetchSource('offmarker'), 'offmarker');
  await expect(
    page.getByTestId('console-entry-row').filter({ hasText: 'offmarker' }).first()
  ).toContainText(/status"?\s*200/);
  expect(hits.length).toBeGreaterThanOrEqual(1);
});

test('the Labs tab and the network row read in Spanish', async ({ page }) => {
  await boot(page, 'es');
  await openSettings(page);
  await openSettingsTab(page, 'labs');
  await expect(page.getByTestId('settings-tab-labs')).toContainText('Labs');
  await expect(page.getByText('Política de red para el código en ejecución')).toBeVisible();
  await page.getByTestId('labs-flag-networkPolicy').click();
  await openSettingsTab(page, 'privacy');
  await expect(page.getByText('Red desde el código en ejecución')).toBeVisible();
  await expect(page.getByTestId('privacy-network-policy-block')).toHaveText('Bloquear');
});
