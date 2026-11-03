/**
 * Two tabs of the web build share each sensitive or clearable store: what one tab
 * changes or clears reaches the other and stays gone after that tab's next write,
 * while each tab keeps its own working state. Runs in both locales and reads state
 * from controls, so it does not depend on copy.
 */

import type { Page, Route } from '@playwright/test';
import {
  createJavaScriptTab,
  expect,
  gotoApp,
  openDeveloperUtilities,
  openSettings,
  openSettingsTab,
  openSnippets,
  seedSession,
  test,
  trackConsoleErrors,
  waitForSeededWorkspaceSettled,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

async function openSecondTab(page: Page) {
  const other = await page.context().newPage();
  await other.setViewportSize({ width: 1440, height: 900 });
  const otherErrors = trackConsoleErrors(other);
  await gotoApp(other);
  return { other, otherErrors };
}

async function openFirstTab(
  page: Page,
  language: 'en' | 'es',
  seed: { primeProLicense?: boolean; snippetCount?: number } = {}
): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedSession(page, { language, ...seed });
  await gotoApp(page);
  await waitForSeededWorkspaceSettled(page);
}

function storedRaw(page: Page, key: string) {
  return page.evaluate((storeKey) => window.localStorage.getItem(storeKey), key);
}

function storedState(page: Page, key: string) {
  return page.evaluate((storeKey) => {
    const raw = window.localStorage.getItem(storeKey);
    return raw ? (JSON.parse(raw) as { state: Record<string, unknown> }).state : null;
  }, key);
}

async function clearStoreFromPrivacy(page: Page, key: string): Promise<void> {
  await openSettings(page);
  await openSettingsTab(page, 'privacy');
  await page.getByTestId(`privacy-local-stores-clear-${key}`).click();
  await page.getByTestId('privacy-clear-confirm-confirm').click();
}

async function countEvents(page: Page, key: string): Promise<void> {
  await page.evaluate((storeKey) => {
    const target = window as unknown as { storeEvents: number };
    target.storeEvents = 0;
    window.addEventListener('storage', (event) => {
      if (event.key === storeKey) target.storeEvents += 1;
    });
  }, key);
}

const eventCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { storeEvents: number }).storeEvents);

// Neither tab answers the other's event with a write of its own.
async function expectTabsSettled(page: Page, other: Page): Promise<void> {
  const settled = [await eventCount(page), await eventCount(other)];
  await page.waitForTimeout(1000);
  expect([await eventCount(page), await eventCount(other)]).toEqual(settled);
}

for (const language of ['en', 'es'] as const) {
  test.describe(`Stores across tabs (${language})`, () => {
    test('a cleared API key leaves the other tab and stays gone', async ({ page }) => {
      const KEY = 'lingua-ai';
      const SECRET = 'sk-cross-tab-secret';
      await openFirstTab(page, language, { primeProLicense: true });
      await openSettings(page);
      await openSettingsTab(page, 'account');
      await page.getByTestId('ai-settings-mode-remote').click();
      await page.getByTestId('ai-settings-endpoint').fill('https://models.example.com/v1/chat/completions');
      await page.getByTestId('ai-settings-key').fill(SECRET);

      const { other, otherErrors } = await openSecondTab(page);
      await openSettings(other);
      await openSettingsTab(other, 'account');
      await expect(other.getByTestId('ai-settings-key')).toHaveValue(SECRET);
      await countEvents(page, KEY);
      await countEvents(other, KEY);

      await page.getByTestId('ai-settings-clear').click();
      await expect(other.getByTestId('ai-settings-key')).toHaveValue('');

      await other.getByTestId('ai-settings-model').fill('model-b');
      await expect.poll(() => storedRaw(other, KEY)).toContain('model-b');
      expect(await storedRaw(other, KEY)).not.toContain(SECRET);
      await expectTabsSettled(page, other);
      expect(otherErrors).toEqual([]);
    });

    test('cleared snippets leave the other tab and stay gone', async ({ page }) => {
      const KEY = 'lingua-snippets';
      await openFirstTab(page, language, { snippetCount: 2 });
      const { other, otherErrors } = await openSecondTab(page);
      await countEvents(page, KEY);
      await countEvents(other, KEY);
      await createJavaScriptTab(other);
      await openSnippets(other);
      await expect.poll(() => storedState(other, KEY)).toMatchObject({ snippets: [{}, {}] });
      const firstName = ((await storedState(other, KEY)) as { snippets: { label: string }[] })
        .snippets[0]!.label;
      await expect(other.getByText(firstName, { exact: true }).first()).toBeVisible();

      await clearStoreFromPrivacy(page, KEY);
      await expect(other.getByText(firstName, { exact: true })).toHaveCount(0);

      await other.getByRole('button', { name: /save active tab|guardar pestaña activa/i }).click();
      await other.locator('button.button-primary:has(svg.lucide-save)').click();
      await expect
        .poll(async () => ((await storedState(other, KEY)) as { snippets: unknown[] } | null)?.snippets.length)
        .toBe(1);
      expect(await storedRaw(other, KEY)).not.toContain(firstName);
      await expectTabsSettled(page, other);
      expect(otherErrors).toEqual([]);
    });

    test('a cleared trust log leaves the other tab', async ({ page }) => {
      const KEY = 'lingua-trust-events';
      const SUMMARY = 'cross-tab-trust-event';
      await openFirstTab(page, language);
      await page.evaluate(
        ({ key, summary }) => {
          window.localStorage.setItem(
            key,
            JSON.stringify({
              state: {
                events: [{ id: 1, at: Date.now(), feature: 'license', action: 'probe', sensitivity: 'low', summary }],
              },
              version: 1,
            })
          );
        },
        { key: KEY, summary: SUMMARY }
      );
      const { other, otherErrors } = await openSecondTab(page);
      await openSettings(other);
      await openSettingsTab(other, 'privacy');
      await expect(other.getByTestId('privacy-recent-list')).toContainText(SUMMARY);

      await clearStoreFromPrivacy(page, KEY);

      await expect(other.getByTestId('privacy-recent-empty')).toBeVisible();
      expect(otherErrors).toEqual([]);
    });

    test('a deleted env var leaves the other tab and stays gone', async ({ page }) => {
      const KEY = 'lingua-env-vars';
      await openFirstTab(page, language);
      await openSettings(page);
      await openSettingsTab(page, 'environment');
      await page.getByTestId('env-vars-key-input').fill('CROSS_TAB_TOKEN');
      await page.getByTestId('env-vars-value-input').fill('secret-value');
      await page.getByTestId('env-vars-add-button').click();

      const { other, otherErrors } = await openSecondTab(page);
      await openSettings(other);
      await openSettingsTab(other, 'environment');
      await expect(other.getByTestId('env-vars-remove-CROSS_TAB_TOKEN')).toBeVisible();
      await countEvents(page, KEY);
      await countEvents(other, KEY);

      await page.getByTestId('env-vars-remove-CROSS_TAB_TOKEN').click();
      await expect(other.getByTestId('env-vars-remove-CROSS_TAB_TOKEN')).toHaveCount(0);

      await other.getByTestId('env-vars-key-input').fill('REGION');
      await other.getByTestId('env-vars-value-input').fill('eu');
      await other.getByTestId('env-vars-add-button').click();
      await expect
        .poll(() => storedState(other, KEY))
        .toMatchObject({ global: { REGION: 'eu' } });
      expect(await storedRaw(other, KEY)).not.toContain('secret-value');
      await expectTabsSettled(page, other);
      expect(otherErrors).toEqual([]);
    });

    test('utility history stays in its tab until a clear removes it', async ({ page }) => {
      const KEY = 'lingua-utility-state';
      await openFirstTab(page, language, { primeProLicense: true });
      const { other, otherErrors } = await openSecondTab(page);
      await openDeveloperUtilities(other);
      await other.getByTestId('utility-apply-button').click();
      await other.getByTestId('utility-history-drawer').click();
      await expect(other.getByTestId('utility-history-entry')).toHaveCount(1);
      await countEvents(page, KEY);
      await countEvents(other, KEY);

      await openDeveloperUtilities(page);
      await page.getByTestId('utility-favorite-toggle-base64').click();
      await expect(other.getByTestId('utility-favorite-base64')).toBeVisible();
      // Session-only history survives another tab's write and never reaches storage.
      await expect(other.getByTestId('utility-history-entry')).toHaveCount(1);
      expect(await storedState(other, KEY)).toMatchObject({ history: {} });

      await clearStoreFromPrivacy(page, KEY);
      await expect(other.getByTestId('utility-favorite-base64')).toHaveCount(0);
      await expect(other.getByTestId('utility-history-empty')).toBeVisible();
      await expectTabsSettled(page, other);
      expect(otherErrors).toEqual([]);
    });

    test('SQL queries reach the other tab, which keeps its own active query', async ({ page }) => {
      const KEY = 'lingua-workspace-sql-state';
      const rows = (target: Page) => target.getByTestId('sql-query-list-row');
      const createQuery = async (target: Page, total: number) => {
        await target.getByTestId('sql-query-list-create').click();
        await expect(rows(target)).toHaveCount(total);
      };
      await openFirstTab(page, language, { primeProLicense: true });
      await page.keyboard.press('ControlOrMeta+Alt+S');
      await createQuery(page, 1);
      await createQuery(page, 2);

      const { other, otherErrors } = await openSecondTab(page);
      await other.keyboard.press('ControlOrMeta+Alt+S');
      await expect(rows(other)).toHaveCount(2);
      await rows(other).first().click();
      const chosen = other.locator('[data-testid="sql-query-list-row"][data-active="true"]');
      const chosenId = await chosen.getAttribute('data-query-id');
      await countEvents(page, KEY);
      await countEvents(other, KEY);

      await createQuery(page, 3);
      await expect(rows(other)).toHaveCount(3);
      await expect(chosen).toHaveAttribute('data-query-id', chosenId as string);

      await clearStoreFromPrivacy(page, KEY);
      await expect(rows(other)).toHaveCount(0);

      await other.getByTestId('sql-query-list-create').click();
      await expect
        .poll(async () => ((await storedState(other, KEY)) as { queries: unknown[] } | null)?.queries.length)
        .toBe(1);
      await expectTabsSettled(page, other);
      expect(otherErrors).toEqual([]);
    });

    // Holding the engine makes this certain: the settle check only sees a late load by chance.
    test('a tab whose SQL engine loads late leaves what the other tab stored', async ({ page, context }) => {
      const KEY = 'lingua-workspace-sql-state';
      const ENGINE = /duckdb-[^/]*\.wasm/;
      const held: Route[] = [];
      await context.route(ENGINE, (route) => {
        held.push(route);
      });
      await openFirstTab(page, language);
      await page.keyboard.press('ControlOrMeta+Alt+S');
      const { other, otherErrors } = await openSecondTab(page);
      await other.keyboard.press('ControlOrMeta+Alt+S');
      await other.getByTestId('sql-query-list-create').click();
      await expect(page.getByTestId('sql-query-list-row')).toHaveCount(1);
      await expect.poll(() => held.length).toBeGreaterThan(0);
      const before = await storedRaw(other, KEY);
      expect(before).toContain(await other.getByTestId('sql-query-list-row').getAttribute('data-query-id'));

      await context.unroute(ENGINE);
      await Promise.all(held.map((route) => route.fallback()));
      await expect(page.getByTestId('sql-explorer-empty')).toBeVisible({ timeout: 60_000 });
      await expect(other.getByTestId('sql-explorer-empty')).toBeVisible({ timeout: 60_000 });

      expect(await storedRaw(other, KEY)).toBe(before);
      expect(otherErrors).toEqual([]);
    });

    test('a deleted HTTP request leaves the other tab and stays gone', async ({ page }) => {
      const KEY = 'lingua-workspace-tool-state';
      const rows = (target: Page) => target.getByTestId('http-request-list-row');
      const requestIds = async (target: Page) =>
        (((await storedState(target, KEY)) as { requests: { id: string }[] } | null)?.requests ?? []).map(
          (request) => request.id
        );
      await openFirstTab(page, language, { primeProLicense: true });
      await page.keyboard.press('ControlOrMeta+Shift+K');
      await expect(page.getByTestId('http-workspace-panel')).toBeVisible();
      await page.getByTestId('http-workspace-empty-create').click();
      await page.getByTestId('http-request-list-create').click();
      await expect(rows(page)).toHaveCount(2);

      const { other, otherErrors } = await openSecondTab(page);
      await other.keyboard.press('ControlOrMeta+Shift+K');
      await expect(rows(other)).toHaveCount(2);
      await countEvents(page, KEY);
      await countEvents(other, KEY);

      const doomed = (await rows(page).first().getAttribute('data-request-id')) as string;
      const kept = (await rows(page).last().getAttribute('data-request-id')) as string;
      const keptRow = other.locator(`[data-testid="http-request-list-row"][data-request-id="${kept}"]`);
      await keptRow.click();
      await expect(keptRow).toHaveAttribute('data-active', 'true');

      // Deleting asks through a native confirm.
      page.once('dialog', (dialog) => void dialog.accept());
      await rows(page).first().hover();
      await rows(page).first().getByTestId('http-request-list-delete').click();
      await expect(rows(other)).toHaveCount(1);
      await expect(keptRow).toHaveAttribute('data-active', 'true');

      await other.getByTestId('http-request-list-create').click();
      await expect.poll(async () => (await requestIds(other)).length).toBe(2);
      expect(await requestIds(other)).not.toContain(doomed);
      await expectTabsSettled(page, other);
      expect(otherErrors).toEqual([]);
    });
  });
}
