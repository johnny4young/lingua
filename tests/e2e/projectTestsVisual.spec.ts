import fs from 'node:fs';
import path from 'node:path';
import { expect, seedSession, test, trackConsoleErrors } from './licenseWeb.helpers';

const screenshotDir = path.resolve(process.cwd(), 'output/playwright/project-tests');

test.describe.configure({ mode: 'serial' });

test.describe('Tests dock tab bilingual evidence', () => {
  test.beforeAll(() => {
    fs.rmSync(screenshotDir, { recursive: true, force: true });
    fs.mkdirSync(screenshotDir, { recursive: true });
  });

  for (const [locale, copy] of [
    ['en', { numeral: '4of 5 passed', fixedNumeral: '5of 5 passed', failedAt: 'Failed at line 10', counts: '1 failed· 1 skipped · Vitest · 4 files · 842 ms', fixed: 'Passed· 1 skipped · Vitest · 4 files · 12 ms', show: 'Show output', noProject: 'Open a project to see its tests' }],
    ['es', { numeral: '4de 5 aprobadas', fixedNumeral: '5de 5 aprobadas', failedAt: 'Falló en la línea 10', counts: '1 fallida· 1 omitida · Vitest · 4 archivos · 842 ms', fixed: 'Aprobadas· 1 omitida · Vitest · 4 archivos · 12 ms', show: 'Mostrar salida', noProject: 'Abre un proyecto para ver sus pruebas' }],
  ] as const) {
    test(`${locale} results by file, a single-test run and the raw output`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 520 });
      const consoleErrors: string[] = [];
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', error => consoleErrors.push(error.message));

      await page.goto(`/?e2e=project-tests&locale=${locale}`);
      const panel = page.getByTestId('tests-panel');
      await expect(page.getByTestId('tests-meter-numeral')).toHaveText(copy.numeral);
      await expect(page.getByTestId('tests-counts')).toHaveText(copy.counts);
      await expect(panel.getByText(copy.failedAt)).toBeVisible();
      await expect(panel.getByTestId('tests-file')).toHaveCount(4);
      const shot = path.join(screenshotDir, `tests-${locale}.png`);
      await page.screenshot({ path: shot, animations: 'disabled' });
      await testInfo.attach(`tests-${locale}.png`, { path: shot, contentType: 'image/png' });

      await page.getByTestId('tests-filter-failed').click();
      await expect(panel.getByTestId('tests-file')).toHaveCount(1);
      await page.getByTestId('tests-filter-all').click();

      const failed = panel.locator('[data-testid="tests-case"][data-status="failed"]');
      await failed.hover();
      await failed.getByTestId('tests-run-test').click();
      await expect(page.getByTestId('tests-stop')).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-project-tests-complete')));
      await expect(page.getByTestId('tests-counts')).toHaveText(copy.fixed);
      await expect(page.getByTestId('tests-meter-numeral')).toHaveText(copy.fixedNumeral);

      await panel.getByRole('button', { name: copy.show }).click();
      await expect(panel.getByTestId('tests-output')).toContainText('first\nwarning\nlast');
      expect(consoleErrors).toEqual([]);
    });

    test(`${locale} empty state with recent projects`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 520 });
      await page.goto(`/?e2e=project-tests&locale=${locale}&state=no-project`);
      const panel = page.getByTestId('tests-panel');
      await expect(panel.getByText(copy.noProject)).toBeVisible();
      await expect(panel.getByTestId('tests-recent-project')).toHaveCount(3);
      await expect(panel.getByTestId('tests-recent-project').first()).toContainText('Vitest');
      const shot = path.join(screenshotDir, `tests-empty-${locale}.png`);
      await page.screenshot({ path: shot, animations: 'disabled' });
      await testInfo.attach(`tests-empty-${locale}.png`, { path: shot, contentType: 'image/png' });
    });
  }
});

const SMALL_DOCK_LAYOUT = JSON.stringify({ 'workspace-panel': 80, 'console-panel': 20 });

test.describe('Tests dock fit in the project window', () => {
  for (const [width, height, locale] of [
    [1024, 768, 'en'],
    [1024, 768, 'es'],
    [1280, 800, 'en'],
    [1600, 1000, 'en'],
    [768, 900, 'en'],
  ] as const) {
    test(`${locale} ${width} px: the tab row fits without scrolling and the failing test shows`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const consoleErrors = trackConsoleErrors(page);
      await seedSession(page, { language: locale, primeProLicense: true });
      // A dock the user never sized, shorter than the board's.
      await page.addInitScript(layout => {
        window.localStorage.setItem('react-resizable-panels:lingua-main-horizontal-layout:workspace-panel:console-panel', layout);
      }, SMALL_DOCK_LAYOUT);
      await page.goto(`/?e2e=project-tests-editor&locale=${locale}`);
      await page.waitForSelector('.monaco-editor .view-lines');
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-open-test-file')));
      await expect(page.getByTestId('tests-panel')).toBeVisible();
      // Narrow windows open the explorer as a drawer over the editor.
      if (width < 1180) await page.keyboard.press('Escape');

      // The first view of the project's tests opens the dock to the board height.
      const dock = page.getByTestId('results-dock');
      await expect.poll(async () => Math.round((await dock.boundingBox())?.height ?? 0)).toBeGreaterThanOrEqual(238);

      const row = page.getByTestId('results-dock-tab-row');
      // Tab glyphs give way first, then control labels; a row narrower than the board moves tabs into More.
      await expect(row).toHaveAttribute('data-fit', width === 1600 ? 'full' : /^(labels|tight)$/);
      const tabList = row.getByRole('tablist');
      const fit = await tabList.evaluate(list => {
        const bounds = list.getBoundingClientRect();
        return {
          scrolls: list.scrollWidth > list.clientWidth,
          cut: Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'))
            .filter(tab => tab.checkVisibility({ visibilityProperty: true }))
            .filter(tab => {
              const box = tab.getBoundingClientRect();
              return box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5 || tab.scrollWidth > tab.clientWidth;
            })
            .map(tab => tab.textContent),
        };
      });
      expect(fit).toEqual({ scrolls: false, cut: [] });
      // Git diff stays reachable: on the row, or in More when the row is short.
      if (!(await page.getByTestId('bottom-panel-git-diff-tab').isVisible())) {
        await page.getByTestId('dock-tabs-more').click();
        await expect(page.getByTestId('dock-tabs-more-git-diff')).toBeVisible();
        await page.keyboard.press('Escape');
      }

      // Every file and the failing test show without scrolling; files without a failure fold to their row.
      const list = page.getByTestId('tests-list');
      await expect(list.getByTestId('tests-file')).toHaveCount(3);
      await expect(list.getByTestId('tests-case')).toHaveCount(3);
      const hidden = await list.evaluate(node => {
        const bottom = node.getBoundingClientRect().bottom + 0.5;
        const rows = [
          ...node.querySelectorAll<HTMLElement>('[data-testid="tests-file"] > div:first-child'),
          ...node.querySelectorAll<HTMLElement>('[data-testid="tests-case"][data-status="failed"]'),
        ];
        return { scrollTop: node.scrollTop, below: rows.filter(row => row.getBoundingClientRect().bottom > bottom).map(row => row.textContent) };
      });
      expect(hidden).toEqual({ scrollTop: 0, below: [] });

      // The raw log opens from the list header.
      await page.getByTestId('tests-output-toggle').click();
      await expect(page.getByTestId('tests-output')).toContainText('Tests  1 failed | 5 passed (6)');
      await page.getByTestId('tests-output-toggle').click();
      await expect(page.getByTestId('tests-output')).toHaveCount(0);
      await page.mouse.move(width - 8, 66);

      const shot = path.join(screenshotDir, `dock-fit-${locale}-${width}.png`);
      await page.screenshot({ path: shot, animations: 'disabled' });
      expect(consoleErrors).toEqual([]);
    });
  }

  test('a dock the user resized keeps its height', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedSession(page, { language: 'en', primeProLicense: true });
    await page.addInitScript(layout => {
      window.localStorage.setItem('react-resizable-panels:lingua-main-horizontal-layout:workspace-panel:console-panel', layout);
      window.localStorage.setItem('lingua-ui:dock-resized', 'true');
    }, SMALL_DOCK_LAYOUT);
    await page.goto('/?e2e=project-tests-editor&locale=en');
    await page.waitForSelector('.monaco-editor .view-lines');
    await page.evaluate(() => window.dispatchEvent(new Event('e2e-open-test-file')));
    await expect(page.getByTestId('tests-panel')).toBeVisible();
    await page.waitForTimeout(400);
    expect((await page.getByTestId('results-dock').boundingBox())?.height).toBeLessThan(200);
  });
});
