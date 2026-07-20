/**
 * internal Vim mode integration — Playwright E2E.
 *
 * Verifies the lazy-loaded `monaco-vim` chunk wires the Vim layer into
 * the active Monaco editor end-to-end:
 *
 *   1. Toggle on via Settings → editor receives Vim keybindings,
 *      localized status bar shows the active mode.
 *   2. `i hello Esc` writes "hello" then leaves insert mode.
 *   3. `qa A world Esc q` records a macro into register `a`;
 *      `@a` replays it and types "world" again — proving monaco-vim's
 *      native macro support is reachable through the Lingua surface.
 *   4. Command palette exposes "Toggle Vim mode" and flipping it on
 *      mounts the status bar.
 *
 * Vim mode is free-tier — no license seeding required. The integration
 * is non-trivial enough that the tier-agnostic E2E catches drift
 * (upstream `monaco-vim` API breakage, lazy-chunk regressions, our
 * own dispose logic) that the unit tests would miss.
 */

import {
  closeSettings,
  createJavaScriptTab,
  expect,
  gotoApp,
  openSettings,
  paletteInput,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Vim mode', () => {
  test.beforeEach(async ({ page }) => {
    // Free tier — Vim mode is not a Pro feature.
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await createJavaScriptTab(page);
  });

  test('toggling Vim mode via Settings activates monaco-vim and shows the localized status bar', async ({
    page,
  }) => {
    await openSettings(page);
    await page.getByRole('tab', { name: 'Editor' }).click();
    const toggle = page.getByRole('switch', { name: /^Vim mode$/ });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await closeSettings(page);

    // Status bar should be visible and report normal mode (the lazy
    // import resolves and the LocalizedStatusBar fires `setMode` once
    // initVimMode attaches).
    const statusBar = page.getByTestId('vim-status-bar');
    await expect(statusBar).toBeVisible();
    await expect(statusBar).toContainText('-- NORMAL --', { timeout: 10_000 });
  });

  test('insert mode and Esc round-trip writes user keystrokes into the editor', async ({
    page,
  }) => {
    await openSettings(page);
    await page.getByRole('tab', { name: 'Editor' }).click();
    await page.getByRole('switch', { name: /^Vim mode$/ }).click();
    await closeSettings(page);

    await expect(page.getByTestId('vim-status-bar')).toContainText('-- NORMAL --', {
      timeout: 10_000,
    });

    // Focus the editor, then press `i` to enter insert mode.
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press('i');
    await expect(page.getByTestId('vim-status-bar')).toContainText('-- INSERT --');

    await page.keyboard.type('hello');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('vim-status-bar')).toContainText('-- NORMAL --');

    // Editor content includes "hello" (Monaco renders text into the
    // .view-line nodes; querying via locator is enough for a smoke).
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('hello');
  });

  test('recording and replaying a simple Vim macro writes the sequence twice', async ({
    page,
  }) => {
    await openSettings(page);
    await page.getByRole('tab', { name: 'Editor' }).click();
    await page.getByRole('switch', { name: /^Vim mode$/ }).click();
    await closeSettings(page);

    await expect(page.getByTestId('vim-status-bar')).toContainText('-- NORMAL --', {
      timeout: 10_000,
    });

    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press('q');
    await page.keyboard.press('a');
    await page.keyboard.press('A');
    await expect(page.getByTestId('vim-status-bar')).toContainText('-- INSERT --');
    await page.keyboard.type(' macro');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('vim-status-bar')).toContainText('-- NORMAL --');
    await page.keyboard.press('q');

    await page.keyboard.type('@a');

    await expect(page.locator('.monaco-editor .view-lines')).toContainText(/macro.*macro/);
  });

  test('command palette Toggle Vim mode turns Vim on and the status bar appears', async ({
    page,
  }) => {
    // Status bar starts hidden because vimMode defaults to false.
    await expect(page.getByTestId('vim-status-bar')).toBeHidden();

    // Open the palette via the keyboard shortcut. The toolbar-button
    // path races with the OverlayBackdrop fade-in: the click resolves
    // against the button, but by the time pointer events fire the
    // backdrop has covered it and Playwright reports "intercepts pointer
    // events". The keyboard path bypasses the click-pointer race.
    await page.keyboard.press('Meta+Shift+KeyP');
    await expect(paletteInput(page)).toBeVisible();
    await paletteInput(page).fill('vim');
    // Click the filtered command directly. `openPaletteAction(page, query, actionName)`
    // would call `openCommandPalette` again and race against the already-open
    // backdrop, so we drive the click ourselves once the palette is up.
    // Palette rows are aria options (combobox + listbox pattern), not
    // buttons — target the row via its stable data-result-index hook.
    await page
      .locator('[data-result-index]')
      .filter({ hasText: /Toggle Vim mode/i })
      .first()
      .click();

    // Palette closed and Vim mode is now on — status bar mounts and
    // monaco-vim emits the localized normal-mode label.
    await expect(page.getByTestId('vim-status-bar')).toContainText('-- NORMAL --', {
      timeout: 10_000,
    });

    // Settings reflects the new state — palette and Settings are the
    // two entry points and they share the same store-driven flag.
    await openSettings(page);
    await page.getByRole('tab', { name: 'Editor' }).click();
    await expect(page.getByRole('switch', { name: /^Vim mode$/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });
});
