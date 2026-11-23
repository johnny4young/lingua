import type { Page } from '@playwright/test';
import { expect, gotoApp, openSettings, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

const PACKS = {
  ink: { theme: 'dark', editorTheme: 'lingua-ink' },
  paper: { theme: 'light', editorTheme: 'lingua-paper' },
} as const;

async function emulateTransparency(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return (value: 'reduce' | 'no-preference') =>
    cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value }],
    });
}

async function openSettingsIn(page: Page, palette: keyof typeof PACKS) {
  await seedSession(page, { language: 'en', appearance: PACKS[palette] });
  await gotoApp(page);
  await expect(page.locator('html')).toHaveAttribute('data-palette', palette);
  await openSettings(page);
  return page.getByRole('dialog', { name: /workspace settings/i });
}

function shellStyle(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('.settings-modal-shell');
    const backdrop = card?.closest<HTMLElement>('.overlay-backdrop');
    if (!card || !backdrop) throw new Error('Settings shell is not mounted');
    const alpha = (color: string) => Number(/(?:\/\s*|rgba\([^)]*,\s*)([\d.]+)\)$/u.exec(color)?.[1] ?? 1);
    return {
      cardBlur: getComputedStyle(card).backdropFilter,
      cardAlpha: alpha(getComputedStyle(card).backgroundColor),
      backdropBlur: getComputedStyle(backdrop).backdropFilter,
    };
  });
}

for (const palette of ['ink', 'paper'] as const) {
  test(`Settings in ${palette} drops blur and translucency under Reduce Transparency`, async ({ page }) => {
    const setTransparency = await emulateTransparency(page);
    await setTransparency('reduce');
    await expect(await openSettingsIn(page, palette)).toBeVisible();
    expect(await shellStyle(page)).toEqual({ cardBlur: 'none', cardAlpha: 1, backdropBlur: 'none' });

    // Without the preference the blur returns; the identity shell stays solid so muted labels keep 4.5:1.
    await setTransparency('no-preference');
    expect(await shellStyle(page)).toEqual({ cardBlur: 'blur(24px)', cardAlpha: 1, backdropBlur: 'blur(24px)' });
  });
}
