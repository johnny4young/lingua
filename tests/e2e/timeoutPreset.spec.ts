/**
 * implementation — execution timeout preset end-to-end smoke.
 *
 * Locks the user-visible contract:
 *
 *   - With the JS preset seeded to `'quick'` (5 s), an infinite loop
 *     trips the timeout pill within ~7 s.
 *   - The Settings preset persists across reload.
 *   - The magic-comment `// @timeout 2s` directive overrides the
 *     preset for the run.
 *
 * Monaco gesture pattern matches `autoLogScratchpad.spec.ts`.
 */

import type { Page } from '@playwright/test';
import {
  createJavaScriptTab,
  dismissWhatsNew,
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

async function seedTimeoutPreset(
  page: Page,
  language: 'javascript' | 'typescript' | 'python' | 'go',
  preset: 'quick' | 'normal' | 'long' | 'extended'
): Promise<void> {
  await page.addInitScript(
    ({ language, preset }) => {
      const settingsKey = 'lingua-settings';
      const raw = window.localStorage.getItem(settingsKey);
      const parsed = raw
        ? JSON.parse(raw)
        : { state: {}, version: 0 };
      parsed.state = parsed.state ?? {};
      parsed.state.runtimeTimeoutPresetByLanguage = {
        ...(parsed.state.runtimeTimeoutPresetByLanguage ?? {}),
        [language]: preset,
      };
      window.localStorage.setItem(settingsKey, JSON.stringify(parsed));
    },
    { language, preset }
  );
}

test.describe('execution timeout preset ', () => {
  test('JS preset quick (5s) trips the timeout pill on an infinite loop', async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await seedSession(page, { language: 'en' });
    await seedTimeoutPreset(page, 'javascript', 'quick');
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await replaceEditorText(page, 'while (true) {}');

    const pill = page.locator(
      '[data-result-kind="run-status-pill"][data-run-status="timeout"]'
    );
    // ~5 s deadline + worker terminate latency + render → 7s is comfy.
    await expect(pill).toBeVisible({ timeout: 8_000 });
    await expect(pill).toContainText(/Timeout/i);
  });

  test('magic-comment override beats the preset', async ({ page }) => {
    test.setTimeout(45_000);
    await seedSession(page, { language: 'en' });
    // Seed the preset to `extended` (5 min) so we can prove the
    // magic-comment directive trims the deadline to 2 s.
    await seedTimeoutPreset(page, 'javascript', 'extended');
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await replaceEditorText(page, '// @timeout 2s\nwhile (true) {}');

    const pill = page.locator(
      '[data-result-kind="run-status-pill"][data-run-status="timeout"]'
    );
    // 2 s deadline → terminate by ~4 s.
    await expect(pill).toBeVisible({ timeout: 6_000 });
  });

  test('preset persists across reload', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await seedTimeoutPreset(page, 'javascript', 'long');
    await gotoApp(page);
    await dismissWhatsNew(page);

    const persisted = await page.evaluate(() => {
      const raw = window.localStorage.getItem('lingua-settings');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed.state?.runtimeTimeoutPresetByLanguage?.javascript ?? null;
    });
    expect(persisted).toBe('long');

    await page.reload();
    await dismissWhatsNew(page);

    const stillPersisted = await page.evaluate(() => {
      const raw = window.localStorage.getItem('lingua-settings');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed.state?.runtimeTimeoutPresetByLanguage?.javascript ?? null;
    });
    expect(stillPersisted).toBe('long');
  });
});
