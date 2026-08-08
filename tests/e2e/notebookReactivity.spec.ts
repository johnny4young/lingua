import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import {
  expect,
  gotoApp,
  seedSession,
  test,
  waitForSeededWorkspaceSettled,
} from './licenseWeb.helpers';
import { isKnownBenignConsoleError } from './consoleErrorFilter';

const screenshotDir = path.resolve(
  process.cwd(),
  'output/playwright/notebook-reactivity'
);

test.describe.configure({ mode: 'serial' });

async function editCell(page: Page, row: Locator, code: string): Promise<void> {
  const staticView = row.getByTestId('notebook-code-cell-static');
  if ((await staticView.count()) > 0) await staticView.click();
  const editor = row.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(code);
}

async function createStaleNotebook(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Alt+N');
  await expect(page.getByTestId('notebook-view')).toBeVisible();
  await page.getByTestId('notebook-toolbar-add-code').click();
  await expect(page.getByTestId('notebook-code-cell-row')).toHaveCount(2);

  const first = page.getByTestId('notebook-code-cell-row').first();
  const second = page.getByTestId('notebook-code-cell-row').nth(1);
  await editCell(
    page,
    first,
    "const base = 21; console.log('base', base);"
  );
  await first.getByTestId('notebook-code-cell-run').click();
  await expect(first.getByTestId('notebook-code-cell-status')).toContainText(
    /Ok|Listo/u
  );

  await editCell(page, second, "console.log('answer', base * 2);");
  await second.getByTestId('notebook-code-cell-run').click();
  await expect(second.getByTestId('notebook-code-cell-outputs')).toContainText(
    'answer 42'
  );

  await editCell(
    page,
    first,
    "const base = 10; console.log('base', base);"
  );
  await second.click();
  await expect(page.getByTestId('notebook-reactivity-banner')).toBeVisible();
  await expect(first.getByTestId('notebook-code-cell-status')).toHaveAttribute(
    'data-status',
    'stale'
  );
  await expect(second.getByTestId('notebook-code-cell-status')).toHaveAttribute(
    'data-status',
    'stale'
  );
  // Lazy means visible results remain unchanged until the explicit replay.
  await expect(first.getByTestId('notebook-code-cell-outputs')).toContainText(
    'base 21'
  );
  await expect(second.getByTestId('notebook-code-cell-outputs')).toContainText(
    'answer 42'
  );
}

test.beforeAll(() => {
  fs.rmSync(screenshotDir, { recursive: true, force: true });
  fs.mkdirSync(screenshotDir, { recursive: true });
});

for (const locale of ['en', 'es'] as const) {
  test(`${locale} marks executed cells stale and refreshes only on request`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('console', message => {
      if (
        message.type() === 'error' &&
        !isKnownBenignConsoleError(message.text())
      ) {
        errors.push(message.text());
      }
    });
    page.on('pageerror', error => {
      if (!isKnownBenignConsoleError(error.message)) errors.push(error.message);
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Pin every measured duration the UI would render (cell badges, response
    // meta). Real runs cannot reproduce their own wall-clock numbers, and this
    // capture must be byte-identical across runs. See testing/e2eDurations.ts.
    await page.addInitScript(() => {
      (window as { __linguaE2eFixedDurationMs?: number }).__linguaE2eFixedDurationMs = 12;
    });
    await seedSession(page, { language: locale, primeProLicense: true });
    await gotoApp(page);
    await waitForSeededWorkspaceSettled(page);
    await createStaleNotebook(page);

    const banner = page.getByTestId('notebook-reactivity-banner');
    await expect(banner).toContainText(
      locale === 'es'
        ? '2 celdas ejecutadas necesitan actualizarse'
        : '2 executed cells need a refresh'
    );
    const refresh = page.getByTestId('notebook-toolbar-refresh-stale');
    await expect(refresh).toContainText(
      locale === 'es' ? 'Actualiza 2' : 'Refresh 2'
    );
    await expect
      .poll(() =>
        page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))
      )
      .toEqual({ clientWidth: 1440, scrollWidth: 1440 });

    const stalePath = path.join(
      screenshotDir,
      `notebook-reactivity-stale-${locale}.png`
    );
    // Park the pointer and drop focus before capturing: Playwright leaves the
    // virtual mouse wherever the last click landed, so a toolbar button can be
    // captured with its hover/focus styling half-applied — measured as a
    // handful of border pixels flipping between runs on the Run all pill.
    await page.mouse.move(0, 0);
    await page.evaluate(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      // Two frames: Monaco hides its caret on the next paint, and a capture
      // taken in between kept a one-pixel antialiased remnant of it.
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    await page.screenshot({ path: stalePath, fullPage: false, animations: 'disabled' });
    await testInfo.attach(`notebook-reactivity-stale-${locale}.png`, {
      path: stalePath,
      contentType: 'image/png',
    });

    await refresh.click();
    const first = page.getByTestId('notebook-code-cell-row').first();
    const second = page.getByTestId('notebook-code-cell-row').nth(1);
    await expect(banner).toHaveCount(0);
    await expect(first.getByTestId('notebook-code-cell-outputs')).toContainText(
      'base 10'
    );
    await expect(second.getByTestId('notebook-code-cell-outputs')).toContainText(
      'answer 20'
    );
    await expect
      .poll(() =>
        page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollLeft: document.documentElement.scrollLeft,
          scrollWidth: document.documentElement.scrollWidth,
        }))
      )
      .toEqual({ clientWidth: 1440, scrollLeft: 0, scrollWidth: 1440 });

    const refreshedPath = path.join(
      screenshotDir,
      `notebook-reactivity-refreshed-${locale}.png`
    );
    // Park the pointer and drop focus before capturing: Playwright leaves the
    // virtual mouse wherever the last click landed, so a toolbar button can be
    // captured with its hover/focus styling half-applied — measured as a
    // handful of border pixels flipping between runs on the Run all pill.
    await page.mouse.move(0, 0);
    await page.evaluate(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      // Two frames: Monaco hides its caret on the next paint, and a capture
      // taken in between kept a one-pixel antialiased remnant of it.
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    await page.screenshot({ path: refreshedPath, fullPage: false, animations: 'disabled' });
    await testInfo.attach(`notebook-reactivity-refreshed-${locale}.png`, {
      path: refreshedPath,
      contentType: 'image/png',
    });
    expect(errors).toEqual([]);
  });
}
