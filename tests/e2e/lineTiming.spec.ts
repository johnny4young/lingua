/**
 * implementation — inline per-line timing end-to-end.
 *
 * Locks the acceptance criteria on the production web build:
 *   - a buffer with `// @time` renders a timing chip per top-level
 *     statement after the scratchpad run,
 *   - the slowest statement carries the hot-spot marker,
 *   - without the directive (and with the Setting off) no chip renders.
 *
 * Monaco gesture pattern matches `autoLogScratchpad.spec.ts`: click the
 * editor body, keyboard-replace the buffer, let the scratchpad auto-run.
 */

import type { Page } from '@playwright/test';
import {
  createJavaScriptTab,
  expect,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';

async function replaceEditorText(page: Page, source: string): Promise<void> {
  await page
    .locator('.monaco-editor')
    .first()
    .click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
  );
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(source);
}

const TIMED_SOURCE = [
  '// @time',
  'const rows = Array.from({ length: 50 }, (_, i) => i);',
  'const doubled = rows.map(n => n * 2);',
  'let total = 0;',
  'for (const n of doubled) {',
  '  total += n;',
  '}',
  'console.log(total);',
].join('\n');

test.describe('inline per-line timing', () => {
  test('a // @time buffer renders per-statement chips with one hot spot', async ({
    page,
  }) => {
    await seedSession(page);
    await gotoApp(page);
    await createJavaScriptTab(page);

    await replaceEditorText(page, TIMED_SOURCE);

    const chips = page.getByTestId('lingua-inline-timing');
    await expect(chips.first()).toBeVisible({ timeout: 15_000 });
    // One chip per instrumented top-level statement (5 statements:
    // lines 2, 3, 4, the for-loop, and the console.log).
    await expect(chips).toHaveCount(5);
    await expect(chips.first()).toContainText('ms');
    // Exactly one hot-spot marker.
    await expect(page.locator('[data-testid="lingua-inline-timing"][data-slowest="true"]')).toHaveCount(1);
  });

  test('no directive and Setting off means zero timing chips', async ({ page }) => {
    await seedSession(page);
    await gotoApp(page);
    await createJavaScriptTab(page);

    await replaceEditorText(page, 'const plain = 1 + 2;\nconsole.log(plain);');

    // Wait for the auto-run to publish its console output, then assert
    // the timing surface stayed empty.
    await expect(page.getByTestId('lingua-inline-result').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('lingua-inline-timing')).toHaveCount(0);
  });
});
