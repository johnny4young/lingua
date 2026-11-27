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
  await expect(second.getByTestId('notebook-cell-answers')).toContainText(
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
  await expect(second.getByTestId('notebook-cell-answers')).toContainText(
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
        ? '2 celdas desactualizadas'
        : '2 cells are stale'
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
    await expect(first.getByTestId('notebook-cell-answers')).toContainText(
      'base 10'
    );
    await expect(second.getByTestId('notebook-cell-answers')).toContainText(
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

const CREATE_SQL = [
  'CREATE TABLE by_city AS',
  'SELECT city, sum(total) AS revenue',
  "FROM (VALUES ('Medellin', 818.4, 'paid'), ('Cali', 301.7, 'paid'), ('Bogota', 731.1, 'open')) AS o(city, total, status)",
  "WHERE status = 'paid'",
  'GROUP BY city;',
].join('\n');

async function addCodeCell(page: Page, language: 'sql' | 'python'): Promise<Locator> {
  const rows = page.getByTestId('notebook-code-cell-row');
  const before = await rows.count();
  await page.getByTestId('notebook-toolbar-add-code').click();
  await expect(rows).toHaveCount(before + 1);
  const row = rows.nth(before);
  await row.getByTestId('notebook-code-cell-language').selectOption(language);
  return row;
}

async function expectStatus(row: Locator, status: string, timeout?: number): Promise<void> {
  await expect(row.getByTestId('notebook-code-cell-status')).toHaveAttribute(
    'data-status',
    status,
    timeout === undefined ? {} : { timeout }
  );
}

test('SQL tables and Python cells refresh with one click after an edit', async ({
  page,
}, testInfo) => {
  // Pyodide boots on the first Python run and DuckDB on the first SQL run.
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => {
    if (!isKnownBenignConsoleError(error.message)) errors.push(error.message);
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seedSession(page, { language: 'en', primeProLicense: true });
  await gotoApp(page);
  await waitForSeededWorkspaceSettled(page);

  await page.keyboard.press('ControlOrMeta+Alt+N');
  await expect(page.getByTestId('notebook-view')).toBeVisible();
  const rows = page.getByTestId('notebook-code-cell-row');
  const create = rows.first();
  await create.getByTestId('notebook-code-cell-language').selectOption('sql');
  await editCell(page, create, CREATE_SQL);
  const select = await addCodeCell(page, 'sql');
  await editCell(page, select, 'SELECT city, revenue FROM by_city ORDER BY revenue DESC;');
  const tickets = await addCodeCell(page, 'python');
  await editCell(page, tickets, 'tickets = [151.2, 146.9, 130.86]\navg = sum(tickets) / len(tickets)');
  const over = await addCodeCell(page, 'python');
  await editCell(page, over, 'over = [t for t in tickets if t > avg]\nlen(over)');

  await page.getByTestId('notebook-toolbar-run-all').click();
  await expectStatus(over, 'ok', 120_000);
  for (const row of [create, select, tickets]) await expectStatus(row, 'ok');
  await expect(over.locator('[data-testid="notebook-cell-answer"][data-line="2"]')).toContainText('2');

  const toolbarHeight = () =>
    page.evaluate(() => document.querySelector('[data-testid="notebook-stale-notice-slot"]')!.closest('header')!.offsetHeight);
  const heightWithoutNotice = await toolbarHeight();

  // Edit a Python cell, then press its Run button straight from the editor.
  await editCell(page, tickets, 'tickets = [151.2, 146.9, 130.86, 171.05]\navg = sum(tickets) / len(tickets)');
  await tickets.getByTestId('notebook-code-cell-run').click();
  await expectStatus(tickets, 'ok', 30_000);
  await expectStatus(over, 'stale');
  for (const row of [create, select]) await expectStatus(row, 'ok');
  // The notice never adds a toolbar row, so nothing below it moves.
  await expect(page.getByTestId('notebook-reactivity-banner')).toBeVisible();
  expect(await toolbarHeight()).toBe(heightWithoutNotice);

  const staleShot = testInfo.outputPath('notebook-stale-replay-python.png');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: staleShot, animations: 'disabled' });
  await testInfo.attach('notebook-stale-replay-python.png', { path: staleShot, contentType: 'image/png' });

  const refreshCell = over.getByTestId('notebook-code-cell-run');
  await expect(refreshCell).toHaveText(/Refresh cell/u);
  await refreshCell.click();
  await expectStatus(over, 'ok', 30_000);
  await expect(over.locator('[data-testid="notebook-cell-answer"][data-line="2"]')).toContainText('2');

  // Edit the SQL cell that made the table: Run replaces it instead of failing.
  await editCell(page, create, CREATE_SQL.replace("status = 'paid'", "status <> 'void'"));
  await create.getByTestId('notebook-code-cell-run').click();
  await expectStatus(create, 'ok', 30_000);
  await expect(create).not.toContainText('already exists');
  await expectStatus(select, 'stale');
  await select.getByTestId('notebook-code-cell-run').click();
  await expectStatus(select, 'ok', 30_000);
  await expect(select).toContainText('3');
  await expect(page.getByTestId('notebook-view')).not.toContainText('already exists');

  // Refresh n replays every stale cell without re-running SQL that is current.
  await expect(page.getByTestId('notebook-reactivity-banner')).toBeVisible();
  await page.getByTestId('notebook-toolbar-refresh-stale').click();
  await expect(page.getByTestId('notebook-reactivity-banner')).toHaveCount(0);
  for (const row of [create, select, tickets, over]) await expectStatus(row, 'ok');

  const doneShot = testInfo.outputPath('notebook-stale-replay-done.png');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: doneShot, animations: 'disabled' });
  await testInfo.attach('notebook-stale-replay-done.png', { path: doneShot, contentType: 'image/png' });
  expect(errors).toEqual([]);
});
