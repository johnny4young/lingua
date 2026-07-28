/**
 * implementation — runtime bootstrap progress end-to-end.
 *
 * Locks the pipeline on the production web build: the first Python run
 * boots Pyodide, and while its WASM downloads the run button's loading
 * label upgrades from the static "Loading Python runtime (Pyodide)..."
 * to the live byte counter ("… 12 MB / 60 MB" — or loaded-only when
 * the server sent no Content-Length). The worker ALWAYS posts the
 * final chunk's progress, so even a fast local serve surfaces at
 * least one MB reading. The run itself must still complete cleanly.
 */

import {
  clickRun,
  createLanguageTab,
  expect,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe('runtime bootstrap progress', () => {
  test('the first Python run streams download progress into the loading label', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Simulate a slow network for the big Pyodide asset (the AC's
    // DevTools-throttling scenario): the initialization window stays
    // open long enough for the label samples to catch both the static
    // message and the live MB counter.
    await page.route('**/pyodide.asm.wasm', async route => {
      await new Promise(resolve => setTimeout(resolve, 2_500));
      await route.continue();
    });
    // Keep both startup tabs in explicit Run mode. Otherwise the seeded
    // JavaScript scratchpad and the new Python scratchpad can auto-run while
    // this test starts its manual run, leaving two workers racing to publish
    // the result and bootstrap label.
    await seedSession(page, {
      workflowModeDefaultsByLanguage: {
        javascript: 'run',
        python: 'run',
      },
    });
    await gotoApp(page);

    // Open a Python tab via the action-pill language menu and replace
    // the template buffer wholesale (same gesture as magicWatch.spec).
    await createLanguageTab(page, /^Python\b/i, /PY .*\.py/i);
    await page.locator('.monaco-editor .view-lines').first().waitFor();
    await page
      .locator('.monaco-editor')
      .first()
      .click({ position: { x: 140, y: 42 } });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText('print(21 * 2)');

    // Sample the run-button label from BEFORE the run starts so the
    // transient progress text cannot slip between polls.
    await page.evaluate(() => {
      const w = window as unknown as { __labels: Set<string>; __timer: number };
      w.__labels = new Set<string>();
      w.__timer = window.setInterval(() => {
        const button = document.querySelector('[data-testid="action-pill-run"]');
        if (button?.textContent) w.__labels.add(button.textContent.trim());
      }, 50);
    });

    // The seeded workflow default prevents any competing auto-run, so this is
    // the one and only Python bootstrap whose progress and result we observe.
    await clickRun(page);

    // Pyodide boot + run: wait for the printed result in the console.
    await expect(page.getByText('42', { exact: true }).first()).toBeVisible({
      timeout: 90_000,
    });

    const labels = await page.evaluate(() => {
      const w = window as unknown as { __labels: Set<string>; __timer: number };
      window.clearInterval(w.__timer);
      return [...w.__labels];
    });
    // The static init message appeared…
    expect(labels.some(label => label.includes('Loading Python runtime'))).toBe(true);
    // …and at least one sample carried the live MB counter.
    expect(labels.some(label => /\d+(\.\d+)? MB/.test(label))).toBe(true);
  });
});
