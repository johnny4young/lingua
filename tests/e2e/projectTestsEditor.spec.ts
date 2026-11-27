import fs from 'node:fs';
import path from 'node:path';
import type { Locator } from '@playwright/test';
import { expect, seedSession, test, trackConsoleErrors } from './licenseWeb.helpers';

// A pointer click at the element's centre, without the scroll-into-view an action click does first:
// that scroll moves Monaco's overflow-hidden layer, which a user's click never does.
async function mouseClick(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('target is not rendered');
  await target.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const screenshotDir = path.resolve(process.cwd(), 'output/playwright/project-tests-editor');

test.describe.configure({ mode: 'serial' });

test.describe('test results on the line', () => {
  test.beforeAll(() => {
    fs.mkdirSync(screenshotDir, { recursive: true });
  });

  for (const [locale, copy] of [
    ['en', { suite: 'Suite2 of 3 passed', failed: 'Failed3 ms · at line 19', received: 'Received4.9expected0', open: 'Open shipping.ts:4', uncommitted: 'changed, not committed', changed: 'main · 2 changed', tally: '2 / 32 of 3 tests passed', active: 'zsh · active', meter: '5of 6 passed', heading: '1 failed· Vitest · 3 files · 412 ms', failedOnly: 'Failed only1', header: 'You writeLingua answers· Test results on the line' }],
    ['es', { suite: 'Grupo2 de 3 aprobadas', failed: 'Fallida3 ms · en la línea 19', received: 'Recibido4.9se esperaba0', open: 'Abrir shipping.ts:4', uncommitted: 'cambiado, sin confirmar', changed: 'main · 2 cambios', tally: '2 / 32 de 3 pruebas aprobadas', active: 'zsh · activa', meter: '5de 6 aprobadas', heading: '1 fallida· Vitest · 3 archivos · 412 ms', failedOnly: 'Solo fallidas1', header: 'Tú escribesLingua responde· Resultados de pruebas en la línea' }],
  ] as const) {
    test(`${locale} answers on the test lines and the change under test${locale === 'es' ? ' in the light theme' : ''}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      const consoleErrors = trackConsoleErrors(page);

      await seedSession(page, { language: locale, primeProLicense: true });
      if (locale === 'es') {
        // The Spanish pass also covers the light theme.
        await page.addInitScript(() => {
          const stored = JSON.parse(window.localStorage.getItem('lingua-settings') ?? '{}');
          stored.state = { ...stored.state, theme: 'light', editorTheme: 'lingua-light' };
          window.localStorage.setItem('lingua-settings', JSON.stringify(stored));
        });
      }
      await page.goto(`/?e2e=project-tests-editor&locale=${locale}`);
      await page.waitForSelector('.monaco-editor .view-lines');
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-open-test-file')));
      await expect(page.getByTestId('tests-panel')).toBeVisible();
      await page.waitForTimeout(800);

      const answer = (line: number) => page.locator(`[data-testid="test-line-answer"][data-line="${line}"]`);
      await expect(page.getByTestId('test-line-answer')).toHaveCount(5);
      await expect(answer(9)).toHaveText(copy.suite);
      await expect(answer(18)).toHaveText(copy.failed);
      await expect(answer(19)).toContainText(copy.received);
      await expect(page.getByTestId('answer-column-header')).toHaveText(copy.header);
      // Ticks on the suite and passing tests, the failing test lit, the cross on its assertion.
      const rail = page.locator('.monaco-editor .cldr.lingua-rail');
      await expect(rail).toHaveCount(5);
      await expect(page.locator('.monaco-editor .cldr.lingua-rail--answered')).toHaveCount(3);
      await expect(page.locator('.monaco-editor .cldr.lingua-rail--reached')).toHaveCount(1);
      await expect(page.locator('.monaco-editor .cldr.lingua-rail--raised')).toHaveCount(1);
      await expect(page.locator('.monaco-editor .test-error-line')).toHaveCount(1);

      // The explorer marks changed files and test results, and sums them under the tree.
      await expect(page.getByTestId('file-tree-git-summary')).toHaveText(copy.changed);
      await expect(page.getByTestId('file-tree-git-src/shipping.ts')).toHaveText('M');
      await expect(page.getByTestId('file-tree-git-src/coupons.ts')).toHaveText('M');
      await expect(page.getByTestId('file-tree-tests-src/cart.test.ts')).toHaveText(copy.tally);
      await expect(page.getByTestId('file-tree-tests-src/cart.test.ts')).toHaveAttribute('data-tone', 'failed');
      await expect(page.getByTestId('file-tree-footer-tests-tally')).toContainText('5 / 6');
      await expect(page.getByTestId('file-tree-footer-terminal-state')).toHaveText(copy.active);

      // A wide dock shows Tests and Terminal side by side, with the Tests meter in the dock's column.
      await expect(page.getByTestId('results-dock-split')).toBeVisible();
      await expect(page.getByTestId('results-dock-split-terminal').getByTestId('project-terminal-status')).toHaveText(copy.active);
      await expect(page.locator('.xterm-screen')).toContainText('pnpm vitest run shipping');
      await expect(page.getByTestId('tests-meter-numeral')).toHaveText(copy.meter);
      await expect(page.getByTestId('tests-counts')).toHaveText(copy.heading);
      await expect(page.getByTestId('tests-filter-failed')).toHaveText(copy.failedOnly);
      await expect(page.getByTestId('bottom-panel-project-terminal-live')).toBeVisible();

      // The Tests tab still opens the failure in the editor.
      await page.locator('[data-testid="tests-case"][data-status="failed"] button').first().click();
      const card = page.getByTestId('test-failure-card');
      await expect(card).toBeVisible();
      await expect(card).toContainText(copy.uncommitted);
      await expect(page.getByTestId('test-failure-change')).toContainText('return total >= 50 ? 0 : 4.9;');
      // The hunk takes the editor's token colors; the line is said once, on the Open chip.
      await expect(page.getByTestId('test-failure-change').locator('[class^="mtk"]').first()).toBeVisible();
      await expect(page.getByTestId('test-failure-change-state')).toHaveText(`M${copy.uncommitted}`);
      await expect(card).not.toContainText(locale === 'en' ? 'line 4' : 'línea 4');
      await expect(page.getByTestId('test-line-open-change')).toHaveText(copy.open);
      await mouseClick(page.getByTestId('test-failure-close'));
      await expect(card).toHaveCount(0);
      await mouseClick(answer(19).getByTestId('test-line-show-failure'));
      await expect(card).toBeVisible();

      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.waitForTimeout(300);
      const shot = path.join(screenshotDir, `project-${locale}.png`);
      await page.screenshot({ path: shot, animations: 'disabled' });
      await testInfo.attach(`project-${locale}.png`, { path: shot, contentType: 'image/png' });

      await page.getByTestId('test-failure-run-again').focus();

      // Focusing inside the card must not scroll the code out of view.
      await expect(page.locator('.view-line', { hasText: 'expect(shipping(41.4))' })).toBeInViewport();
      expect(await page.locator('.monaco-editor .overflow-guard').first().evaluate(node => node.scrollLeft)).toBe(0);

      await page.getByTestId('file-tree-footer-search').click();
      const search = page.getByRole('dialog').filter({ has: page.locator('input') });
      await expect(search).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(search).toHaveCount(0);

      await mouseClick(page.getByTestId('test-failure-explain'));
      await expect(page.getByTestId('ai-explain-panel')).toBeVisible();
      expect(consoleErrors).toEqual([]);
    });
  }
});
