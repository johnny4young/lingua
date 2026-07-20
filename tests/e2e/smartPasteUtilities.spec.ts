/**
 * internal — smart-paste utility suggestions end-to-end.
 *
 * Locks the user-visible contract on the production web build:
 *
 *   - Pasting a JWT into the editor surfaces the low-priority toast
 *     with the catalog's own "Open JWT Debugger" action; accepting it
 *     opens the Developer Utilities workspace on the JWT panel with
 *     the token pre-loaded and decoded.
 *   - Ordinary code pastes (including `5 * 60 * 1000`, which matches
 *     the cron SHAPE) never surface a suggestion.
 *   - The Spanish locale renders the localized toast + action.
 *
 * The paste must be REAL: Monaco's EditContext input only reacts to a
 * trusted paste, so the spec grants clipboard permissions, writes the
 * payload with `navigator.clipboard.writeText`, and presses the
 * platform paste chord — a synthetic `ClipboardEvent` would bypass the
 * editor entirely and prove nothing.
 */

import type { Page } from '@playwright/test';
import {
  createJavaScriptTab,
  expect,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';
import { NON_SECRET_TEST_JWT } from '../__fixtures__/jwt';

const PASTE_CHORD = process.platform === 'darwin' ? 'Meta+V' : 'Control+V';

async function pasteIntoEditor(page: Page, text: string): Promise<void> {
  await page.evaluate(async value => {
    await navigator.clipboard.writeText(value);
  }, text);
  await page.locator('.monaco-editor').first().click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(PASTE_CHORD);
}

test.describe('smart paste — utility suggestions', () => {
  test('pasting a JWT offers the JWT Debugger with the token pre-loaded', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedSession(page);
    await gotoApp(page);
    await createJavaScriptTab(page);

    await pasteIntoEditor(page, NON_SECRET_TEST_JWT);

    const banner = page.getByTestId('status-notice-banner');
    await expect(banner).toContainText('Pasted a JWT token.');
    await banner.getByRole('button', { name: 'Open JWT Debugger' }).click();

    // The Utilities workspace opens on the JWT panel, token loaded and
    // decoded (payload carries the fixture's `sub: lingua`).
    await expect(page.getByTestId('jwt-decode-token')).toContainText(
      NON_SECRET_TEST_JWT.slice(0, 24)
    );
    await expect(page.getByTestId('jwt-payload-output')).toContainText('lingua');
  });

  test('ordinary code pastes never suggest a utility', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedSession(page);
    await gotoApp(page);
    await createJavaScriptTab(page);

    // `5 * 60 * 1000` matches the cron field SHAPE; the bounds guard
    // must keep it silent. The plain statement covers the general case.
    await pasteIntoEditor(page, '5 * 60 * 1000');
    await page.waitForTimeout(600);
    await expect(page.getByTestId('status-notice-banner')).toHaveCount(0);

    await pasteIntoEditor(page, 'const response = await fetch(url);');
    await page.waitForTimeout(600);
    await expect(page.getByTestId('status-notice-banner')).toHaveCount(0);
  });

  test('the Spanish locale localizes the toast and the action', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await createJavaScriptTab(page);

    await pasteIntoEditor(page, NON_SECRET_TEST_JWT);

    const banner = page.getByTestId('status-notice-banner');
    await expect(banner).toContainText('Pegaste un token JWT.');
    await expect(
      banner.getByRole('button', { name: 'Abrir depurador JWT' })
    ).toBeVisible();
  });
});
