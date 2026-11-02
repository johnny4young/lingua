/**
 * Labs › Clipboard-aware utilities: Utilities classifies the clipboard when it
 * opens and on focus, marks the tools that fit and keeps nothing it read.
 */
import type { Page } from '@playwright/test';
import { NON_SECRET_TEST_JWT as JWT } from '../__fixtures__/jwt';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

async function open(page: Page, language: 'en' | 'es', settings: { flag: boolean; consent: string; pro: boolean }) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await seedSession(page, { language, primeProLicense: settings.pro });
  await page.addInitScript(({ flag, consent }) => {
    const stored = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    stored.state.featureFlags = flag ? { clipboardChains: true } : {};
    stored.state.utilitiesClipboardOnFocusConsent = consent;
    localStorage.setItem('lingua-settings', JSON.stringify(stored));
  }, { flag: settings.flag, consent: settings.consent });
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

for (const [language, jwtBanner, cronBanner] of [
  ['en', 'Clipboard looks like a JWT', 'Clipboard looks like a cron expression'],
  ['es', 'El portapapeles parece un JWT', 'El portapapeles parece una expresión cron'],
] as const) {
  test(`marks the tools that fit the clipboard (${language})`, async ({ page }) => {
    await open(page, language, { flag: true, consent: 'granted', pro: true });

    await expand(page);
    await expect(page.getByTestId('utility-clipboard-banner')).toHaveText(jwtBanner);
    await expect(page.getByTestId('utility-suggested-jwt')).toBeVisible();
    await expect(page.getByTestId('utility-suggested-base64')).toBeVisible();
    await expect(page.getByTestId('utility-suggested-cron-parser')).toHaveCount(0);

    await focusWith(page, '0 9 * * 1-5');
    await expect(page.getByTestId('utility-clipboard-banner')).toHaveText(cronBanner);
    await expect(page.getByTestId('utility-suggested-cron-parser')).toBeVisible();
    await expect(page.getByTestId('utility-suggested-jwt')).toHaveCount(0);

    await focusWith(page, 'call me when the build is done');
    await expect(page.getByTestId('utility-clipboard-banner')).toHaveCount(0);
    await expect(page.getByTestId('utility-suggested-cron-parser')).toHaveCount(0);
  });
}

test('marks the category on the folded rail', async ({ page }) => {
  await open(page, 'en', { flag: true, consent: 'granted', pro: true });
  await expand(page);
  await page.keyboard.press('ControlOrMeta+B');
  await expect(page.getByTestId('utility-rail')).toBeVisible();
  await expect(page.getByTestId('utility-rail-crypto-suggested')).toBeVisible();
  await expect(page.getByTestId('utility-rail-time-suggested')).toHaveCount(0);
});

test('keeps nothing it read from the clipboard', async ({ page }) => {
  await open(page, 'en', { flag: true, consent: 'granted', pro: true });
  await expand(page);
  await expect(page.getByTestId('utility-suggested-jwt')).toBeVisible();
  await page.waitForTimeout(1_500);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain(JWT);
  expect(await page.locator('body').innerText()).not.toContain(JWT);
});

for (const [name, settings] of [
  ['without the flag', { flag: false, consent: 'granted', pro: true }],
  ['without consent', { flag: true, consent: 'unset', pro: true }],
  ['on Free', { flag: true, consent: 'granted', pro: false }],
] as const) {
  test(`never classifies the clipboard ${name}`, async ({ page }) => {
    await open(page, 'en', settings);
    await expand(page);
    await focusWith(page, JWT);
    await page.waitForTimeout(300);
    await expect(page.getByTestId('utility-clipboard-banner')).toHaveCount(0);
    await expect(page.getByTestId('utility-suggested-jwt')).toHaveCount(0);
    if (name !== 'without the flag') expect(await reads(page)).toBe(0);
  });
}
