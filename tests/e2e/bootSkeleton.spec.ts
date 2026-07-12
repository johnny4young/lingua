import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './licenseWeb.helpers';

const screenshotDir = 'output/review/g2-perceived-boot';
const ENTRY_HOLD_MS = 80;

async function holdEntryModule(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/.*\.js(?:\?.*)?$/u, async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

async function captureSkeleton(
  page: Page,
  theme: 'dark' | 'light'
): Promise<void> {
  if (theme === 'light') {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'lingua-settings',
        JSON.stringify({
          state: { theme: 'light', editorTheme: 'lingua-light', language: 'es' },
          version: 1,
        })
      );
    });
  }

  const releaseEntry = await holdEntryModule(page);
  const navigation = page.goto('/', { waitUntil: 'domcontentloaded' });
  const skeleton = page.getByTestId('boot-skeleton');
  let documentStart = 0;

  try {
    await expect(skeleton).toBeVisible();
    await expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    await expect(skeleton).toHaveAttribute('inert', '');
    await expect(page.locator('html')).toHaveClass(new RegExp(`(^|\\s)${theme}(\\s|$)`, 'u'));
    await expect
      .poll(() =>
        page.evaluate(
          () => performance.getEntriesByName('lingua:boot:start', 'mark').length
        )
      )
      .toBe(1);
    documentStart = await page.evaluate(
      () => performance.getEntriesByName('lingua:boot:start', 'mark')[0]?.startTime ?? 0
    );
    // Prove the document mark owns module wait time, not just ordering.
    await page.waitForTimeout(ENTRY_HOLD_MS);

    if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
      mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({
        path: `${screenshotDir}/web-${theme}-skeleton.png`,
        animations: 'disabled',
      });
    }
  } finally {
    releaseEntry();
  }

  await navigation;
  await expect(skeleton).toHaveCount(0);
  await expect(page.getByTestId('app-chrome')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        (start) =>
          (performance.getEntriesByName('lingua:boot:system-language', 'mark')[0]?.startTime ??
            start) - start,
        documentStart
      )
    )
    .toBeGreaterThanOrEqual(ENTRY_HOLD_MS);
}

test.describe('perceived startup — IT2-G2', () => {
  test('paints the dark shell before React and removes it after mount', async ({ page }) => {
    await captureSkeleton(page, 'dark');
  });

  test('paints the persisted light shell before Spanish React bootstrap', async ({ page }) => {
    await captureSkeleton(page, 'light');
  });
});
