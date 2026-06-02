/**
 * RL-124 / AUDIT-04 — lazy Monaco language registration.
 *
 * Locks the runtime win of `registerLanguageOnce`: a fresh JavaScript
 * scratchpad must NOT fetch any other language's completion / hover / signature
 * provider chunk, and opening a Python tab must pull the Python provider chunk
 * on demand. This is the regression guard that keeps the per-language lazy
 * registration honest — if a future change re-introduces eager all-language
 * registration, the first assertion fails.
 */
import {
  createJavaScriptTab,
  createLanguageTab,
  expect,
  expectTier,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';

const NON_JS_PROVIDER_CHUNK =
  /(go|rust|python|ruby|lua)(Completions|HoverProvider|SignatureProvider)-[A-Za-z0-9_-]+\.js/i;

test.describe('Lazy Monaco language registration (RL-124)', () => {
  test('JS scratchpad skips other-language provider chunks; Python loads on demand', async ({
    page,
  }) => {
    const providerChunkRequests: string[] = [];
    page.on('request', (request) => {
      if (NON_JS_PROVIDER_CHUNK.test(request.url())) {
        providerChunkRequests.push(new URL(request.url()).pathname);
      }
    });

    // The test keeps the JS scratchpad open, then creates Python as a second
    // tab; that crosses the Free tab budget. The primed license revalidates
    // asynchronously, so wait for the badge before opening Python.
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await expectTier(page, 'PRO');
    await createJavaScriptTab(page);
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    // Let any eager mount-time fetch fire before asserting its absence.
    await page.waitForTimeout(750);

    expect(providerChunkRequests).toEqual([]);

    // Opening Python pulls its provider chunk on demand — proving lazy load.
    await createLanguageTab(page, /^Python\b/i, /PY .*\.py/i);
    await expect
      .poll(() => providerChunkRequests.some((pathname) => /pythonCompletions-/.test(pathname)), {
        timeout: 5000,
      })
      .toBe(true);
  });
});
