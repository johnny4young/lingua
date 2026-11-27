/**
 * A Scratchpad run fills the Console as it goes: Python prints arrive while the
 * run sleeps between them, each row timed from the run's start, the previous
 * run's rows dimmed until reached, and no Running or Completed status rows.
 */

import type { Page } from '@playwright/test';
import {
  createLanguageTab,
  dismissWhatsNew,
  expect,
  gotoApp,
  openConsole,
  replaceEditorText,
  seedSession,
  test,
} from './licenseWeb.helpers';

const LATENCIES_PY = [
  'from statistics import mean, quantiles',
  'from random import gauss',
  'from time import sleep',
  '',
  'api    = [38, 41, 35, 44, 39, 52, 37]',
  'worker = [12, 14, 11, 13, 19, 12, 11]',
  'db     = [92, 88, 97, 118, 90, 86, 94]',
  'latencies = {"api": api, "worker": worker, "db": db}',
  '',
  'averages = {n: round(mean(s), 1) for n, s in latencies.items()}',
  'slowest = max(averages, key=averages.get)',
  '',
  'for name in latencies:',
  '    live = [gauss(averages[name], 4) for _ in range(50)]',
  '    sleep(0.4)',
  '    print(f"{name:<7} µ {mean(live):5.1f} ms")',
  '',
  'print(f"slowest path: {slowest}")',
].join('\n');

const OFFSET = /^\+\d+\.\d\d s$/;
const settled = (page: Page) => page.evaluate(() => window.__linguaE2e?.autoRunSettled?.() ?? false);

/** Type line by line so Monaco's auto-indent does not stack the loop body. */
async function typeLines(page: Page, source: string): Promise<void> {
  await replaceEditorText(page, '');
  for (const [index, line] of source.split('\n').entries()) {
    if (index > 0) {
      await page.keyboard.insertText('\n');
      await page.keyboard.press('Shift+Home');
      await page.keyboard.press('Delete');
    }
    if (line) await page.keyboard.insertText(line);
  }
}

for (const language of ['en', 'es'] as const) {
  test(`a Python Scratchpad run fills the Console while it goes (${language})`, async ({ page }) => {
    // Pyodide boot on the app's own budget, then two runs of about 1.2 s.
    test.setTimeout(210_000);
    await seedSession(page, { language });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createLanguageTab(page, /^Python\b/i, /PY .*\.py/i);
    await typeLines(page, LATENCIES_PY);
    await expect
      .poll(() => page.evaluate(() => window.__linguaE2e?.pythonRuntimeBooted?.() ?? false), {
        timeout: 100_000,
        intervals: [1_000],
      })
      .toBe(true);
    await openConsole(page);

    const rows = page.getByTestId('console-entry-row');
    const slowestRow = rows.filter({ hasText: 'slowest path: db' });
    await expect(slowestRow).toHaveCount(1, { timeout: 60_000 });
    await expect.poll(() => settled(page), { timeout: 60_000 }).toBe(true);
    await expect(rows.filter({ hasText: /Running|Completed in|Completado en/ })).toHaveCount(0);
    await expect(slowestRow.getByTestId('console-row-stamp')).toHaveText(OFFSET);

    // Edit db[3] from 118 to 131: the edit's run streams its rows.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    for (let i = 0; i < 13; i += 1) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('31');
    await expect.poll(() => settled(page), { timeout: 10_000, intervals: [25] }).toBe(false);

    const apiRow = rows.filter({ hasText: /api\s+µ/ });
    await expect(apiRow).toHaveCount(1, { timeout: 30_000 });
    // The first print is on screen while the run still sleeps before the next ones.
    expect(await settled(page)).toBe(false);
    await expect(apiRow.getByTestId('console-row-stamp')).toHaveText(OFFSET);
    await expect(page.getByTestId('console-waiting-row')).toBeVisible();
    await expect(page.getByTestId('console-ghost-row').filter({ hasText: 'slowest path: db' })).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath(`live-tape-midrun-${language}.png`) });

    await expect.poll(() => settled(page), { timeout: 60_000 }).toBe(true);
    await expect(slowestRow).toHaveCount(1);
    await expect(page.getByTestId('console-ghost-row')).toHaveCount(0);
    await expect(page.getByTestId('console-waiting-row')).toHaveCount(0);
    await expect(rows).toHaveCount(4);
    const stamps = await page.getByTestId('console-row-stamp').allTextContents();
    expect(stamps).toHaveLength(4);
    for (const stamp of stamps) expect(stamp).toMatch(OFFSET);
    const seconds = stamps.map(stamp => Number(stamp.slice(1, -2)));
    expect(seconds).toEqual([...seconds].sort((a, b) => a - b));
    expect(seconds[1]! - seconds[0]!).toBeGreaterThanOrEqual(0.3);
  });
}
