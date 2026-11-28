/**
 * Clipboard-aware utilities: Utilities reads the clipboard when it opens
 * and on focus, lists the tools that take it with their answers, and
 * stores nothing it read.
 */
import type { Page } from '@playwright/test';
import { NON_SECRET_TEST_JWT as JWT } from '../__fixtures__/jwt';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

async function open(page: Page, language: 'en' | 'es', settings: { consent: string; pro: boolean }) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await seedSession(page, { language, primeProLicense: settings.pro });
  await page.addInitScript(({ consent }) => {
    const stored = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    stored.state.utilitiesClipboardOnFocusConsent = consent;
    localStorage.setItem('lingua-settings', JSON.stringify(stored));
  }, { consent: settings.consent });
  await gotoApp(page);
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
    const counted = window as unknown as { __reads: number };
    counted.__reads = 0;
    const original = navigator.clipboard.readText.bind(navigator.clipboard);
    navigator.clipboard.readText = () => {
      counted.__reads += 1;
      return original();
    };
  }, JWT);
  await page.keyboard.press('ControlOrMeta+K');
  await expect(page.getByTestId('developer-utilities-workspace')).toBeVisible();
}

const expand = async (page: Page) => {
  const button = page.getByTestId('utility-rail-expand');
  if (await button.isVisible()) await button.click();
};
const focusWith = async (page: Page, text: string) => {
  await page.evaluate(async (value) => {
    await navigator.clipboard.writeText(value);
    window.dispatchEvent(new Event('focus'));
  }, text);
};
const reads = (page: Page) => page.evaluate(() => (window as unknown as { __reads: number }).__reads);

for (const [language, heading, jwtKind, cronKind] of [
  ['en', 'Your clipboard', `JWT · ${JWT.length} chars`, 'Cron · 11 chars'],
  ['es', 'Tu portapapeles', `JWT · ${JWT.length} caracteres`, 'Cron · 11 caracteres'],
] as const) {
  test(`lists the tools that take the clipboard with their answers (${language})`, async ({ page }) => {
    await open(page, language, { consent: 'granted', pro: true });

    await expand(page);
    const head = page.getByTestId('utility-launcher-clipboard-head');
    await expect(head).toContainText(heading);
    await expect(head).toContainText(jwtKind);
    await expect(page.getByTestId('utility-clipboard-jwt')).toBeVisible();
    await expect(page.getByTestId('utility-preview-hash')).toHaveText(/^[0-9a-f]{6}…[0-9a-f]{4}$/u);
    await expect(page.getByTestId('utility-preview-qr-code')).toHaveText(/^v\d+ · M$/u);

    await focusWith(page, '0 9 * * 1-5');
    await expect(head).toContainText(cronKind);
    await expect(page.getByTestId('utility-clipboard-cron-parser')).toBeVisible();
    await expect(page.getByTestId('utility-clipboard-jwt')).toHaveCount(0);

    await focusWith(page, 'call me when the build is done');
    await expect(page.getByTestId('utility-launcher-clipboard')).toHaveCount(0);
    await expect(page.getByTestId('utility-launcher-clipboard-head')).toHaveCount(0);
  });
}

for (const [language, hint] of [
  ['en', 'to show what each tool would answer'],
  ['es', 'para mostrar qué respondería cada herramienta'],
] as const) {
  test(`says when the opt-in reads the clipboard (${language})`, async ({ page }) => {
    await seedSession(page, { language, primeProLicense: true });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+,');
    await page.getByTestId('settings-tab-editor').click();
    await expect(page.getByText(hint)).toBeVisible();
  });
}

test('marks the category on the folded rail', async ({ page }) => {
  await open(page, 'en', { consent: 'granted', pro: true });
  await expand(page);
  await page.keyboard.press('ControlOrMeta+B');
  await expect(page.getByTestId('utility-rail')).toBeVisible();
  await expect(page.getByTestId('utility-rail-crypto-suggested')).toBeVisible();
  await expect(page.getByTestId('utility-rail-time-suggested')).toHaveCount(0);
});

test('keeps nothing it read from the clipboard', async ({ page }) => {
  await open(page, 'en', { consent: 'granted', pro: true });
  await expand(page);
  await expect(page.getByTestId('utility-preview-hash')).toBeVisible();
  await page.waitForTimeout(1_500);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain(JWT);
  expect(await page.locator('body').innerText()).not.toContain(JWT);
});

for (const [name, settings] of [
  ['without consent', { consent: 'unset', pro: true }],
  ['on Free', { consent: 'granted', pro: false }],
] as const) {
  test(`never classifies the clipboard ${name}`, async ({ page }) => {
    await open(page, 'en', settings);
    await expand(page);
    await focusWith(page, JWT);
    await page.waitForTimeout(300);
    await expect(page.getByTestId('utility-launcher-clipboard')).toHaveCount(0);
    await expect(page.getByTestId('utility-suggested-jwt')).toHaveCount(0);
    expect(await reads(page)).toBe(0);
  });
}
