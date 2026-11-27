/**
 * The capsule browser at narrow widths: one scroll area at 375 px with the
 * detail as its own view, a single action row at 768 px, and a dialog that
 * ends above a docked status notice. EN and ES.
 */

import { mkdirSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import {
  clickRun,
  createJavaScriptTab,
  dismissWhatsNew,
  expect,
  expectNoHorizontalOverflow,
  expectTier,
  gotoApp,
  replaceEditorText,
  seedSession,
  test,
  waitForRunCompleted,
} from './licenseWeb.helpers';

const CAPTURE_DIR = process.env.LINGUA_CAPSULE_CAPTURE_DIR;

const OK_SOURCE = 'const api = [38, 41, 35, 44];\nconsole.log("api", api.length);';
const ERROR_SOURCE = 'const api = [38, 41];\nthrow new Error("boom");';

async function capture(page: Page, name: string): Promise<void> {
  if (!CAPTURE_DIR) return;
  mkdirSync(CAPTURE_DIR, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: `${CAPTURE_DIR}/${name}.png` });
}

async function recordRuns(page: Page): Promise<void> {
  await createJavaScriptTab(page);
  for (const source of [OK_SOURCE, ERROR_SOURCE, OK_SOURCE, OK_SOURCE]) {
    await replaceEditorText(page, source);
    await clickRun(page);
    await waitForRunCompleted(page);
  }
}

async function openCapsules(page: Page, title: RegExp): Promise<Locator> {
  await page.keyboard.press('ControlOrMeta+Alt+C');
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** A row is reachable when, scrolled into view, its own center is what the pointer would hit. */
async function expectRowsUncovered(rows: Locator): Promise<void> {
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    await row.scrollIntoViewIfNeeded();
    const hit = await row.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return top !== null && element.contains(top);
    });
    expect(hit, `row ${index} is covered`).toBe(true);
  }
}

const LOCALES = [
  { language: 'en' as const, title: /run capsules/i, back: /capsules/i },
  { language: 'es' as const, title: /cápsulas de ejecución/i, back: /cápsulas/i },
];

for (const { language, title, back } of LOCALES) {
  test.describe(`Capsule browser at narrow widths (${language.toUpperCase()})`, () => {
    test('375 px lists first and opens the detail as its own view', async ({ page }) => {
      await seedSession(page, { language, primeProLicense: true });
      await gotoApp(page);
      await expectTier(page, 'PRO');
      await dismissWhatsNew(page);
      await recordRuns(page);

      await page.setViewportSize({ width: 375, height: 812 });
      const dialog = await openCapsules(page, title);
      await capture(page, `capsules-375-${language}`);

      await expect(dialog.getByTestId('capsule-list-rows')).toBeVisible();
      await expect(dialog.getByTestId('capsule-detail')).toBeHidden();
      await expectRowsUncovered(dialog.getByTestId('capsule-list-row'));
      await expectNoHorizontalOverflow(page);

      await dialog.getByTestId('capsule-list-row').nth(1).click();
      await expect(dialog.getByTestId('capsule-detail')).toBeVisible();
      await expect(dialog.getByTestId('capsule-list-rows')).toBeHidden();
      const backButton = dialog.getByTestId('capsule-detail-back');
      await expect(backButton).toBeFocused();
      await expect(backButton).toHaveAccessibleName(back);
      await capture(page, `capsules-375-detail-${language}`);
      await expectNoHorizontalOverflow(page);

      await backButton.click();
      await expect(dialog.getByTestId('capsule-list-rows')).toBeVisible();
      await expect(dialog.getByTestId('capsule-detail')).toBeHidden();

      // Escape leaves the detail first and keeps the dialog open.
      await dialog.getByTestId('capsule-list-row').first().click();
      await expect(backButton).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog.getByTestId('capsule-list-rows')).toBeFocused();
      await expect(dialog).toBeVisible();
    });

    test('768 px keeps the actions on one row and ends above a notice', async ({ page }) => {
      await seedSession(page, { language, primeProLicense: true });
      await gotoApp(page);
      await expectTier(page, 'PRO');
      await dismissWhatsNew(page);
      await recordRuns(page);

      await page.setViewportSize({ width: 768, height: 900 });
      const dialog = await openCapsules(page, title);
      await capture(page, `capsules-768-${language}`);

      await expect(dialog.getByTestId('capsule-detail')).toBeVisible();
      await expectRowsUncovered(dialog.getByTestId('capsule-list-row'));
      await expectNoHorizontalOverflow(page);

      const actions = dialog.getByTestId('capsule-detail-actions');
      // Centers, not tops: the ⋯ spacer has no height.
      const centers = await actions.evaluate((row) =>
        [...row.children].map((child) => {
          const box = child.getBoundingClientRect();
          return Math.round(box.top + box.height / 2);
        })
      );
      expect(new Set(centers).size, 'actions wrap to a second row').toBe(1);
      await expect(dialog.getByTestId('capsule-list-row-open')).toBeVisible();
      await expect(dialog.getByTestId('capsule-list-share')).toBeVisible();
      await expect(dialog.getByTestId('capsule-compare-button')).toBeVisible();

      // Removing a capsule docks an Undo notice; the dialog must end above it.
      await dialog.getByTestId('capsule-list-more').click();
      await dialog.getByTestId('capsule-list-row-delete').click();
      const notice = page.getByTestId('status-notice-banner');
      await expect(notice).toBeVisible();
      await capture(page, `capsules-768-notice-${language}`);
      await expect
        .poll(async () => {
          const shell = await dialog.boundingBox();
          const banner = await notice.boundingBox();
          return shell !== null && banner !== null && shell.y + shell.height <= banner.y + 1;
        })
        .toBe(true);
      await expect(dialog.getByTestId('capsule-list-shortcut')).toBeVisible();
      // The shrunken body holds the browser exactly: its own scroll areas, never a second one around them.
      await page.setViewportSize({ width: 768, height: 640 });
      await expect(notice).toBeVisible();
      await expect
        .poll(async () => {
          const shell = await dialog.boundingBox();
          const banner = await notice.boundingBox();
          return shell !== null && banner !== null && shell.y + shell.height <= banner.y + 1;
        })
        .toBe(true);
      await expect
        .poll(() => dialog.locator('[data-modal-scroll-region]').evaluate((body) => body.scrollHeight - body.clientHeight))
        .toBeLessThanOrEqual(1);
    });
  });
}

// Evidence only: the wide Pro layout and the Free gate at 375 px.
test('captures the wide and Free layouts', async ({ page }) => {
  test.skip(!CAPTURE_DIR, 'evidence capture only');
  await seedSession(page, { language: 'en', primeProLicense: true });
  await gotoApp(page);
  await expectTier(page, 'PRO');
  await dismissWhatsNew(page);
  await recordRuns(page);
  await openCapsules(page, /run capsules/i);
  await capture(page, 'capsules-1440-en');
  await page.getByTestId('capsule-list-row').filter({ has: page.locator('[data-result="error"]') }).first().click();
  await capture(page, 'capsules-1440-error-en');
});

test('captures the Free gate at 375 px', async ({ page }) => {
  test.skip(!CAPTURE_DIR, 'evidence capture only');
  await seedSession(page, { language: 'en' });
  await gotoApp(page);
  await dismissWhatsNew(page);
  await recordRuns(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await openCapsules(page, /run capsules/i);
  await capture(page, 'capsules-free-375-en');
});
