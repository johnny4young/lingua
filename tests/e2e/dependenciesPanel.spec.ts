/**
 * RL-025 Slice A — Dependencies bottom-panel smoke.
 *
 * The detector runs from the real Monaco buffer, then the shortcut
 * opens the bottom-panel tab. Web classifies JS/TS packages as
 * desktop-only in Slice A, which is the honest state until install
 * support lands in later slices.
 */

import type { Page } from '@playwright/test';
import {
  dismissWhatsNew,
  expect,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';

async function enableDependencyDetection(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const raw = window.localStorage.getItem('lingua-settings');
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = parsed.state ?? {};
    parsed.state.dependencyDetectionEnabled = true;
    window.localStorage.setItem('lingua-settings', JSON.stringify(parsed));
  });
}

async function replaceEditorText(page: Page, source: string): Promise<void> {
  await page
    .locator('.monaco-editor')
    .first()
    .click({ position: { x: 140, y: 42 } });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(source);
}

async function openDependenciesFromShortcut(page: Page): Promise<void> {
  await expect(page.getByTestId('bottom-panel-dependencies-tab')).toHaveCount(0);
  await page.waitForTimeout(700);
  await page.keyboard.press('ControlOrMeta+Shift+J');
  await expect(page.getByTestId('bottom-panel-dependencies-tab')).toBeVisible();
  await expect(page.getByTestId('dependencies-panel')).toBeVisible();
}

test.describe.configure({ mode: 'parallel' });

test.describe('Dependencies panel — RL-025 Slice A', () => {
  test('detects a JS import and opens the panel in English', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await enableDependencyDetection(page);
    await gotoApp(page);
    await dismissWhatsNew(page);

    await replaceEditorText(
      page,
      "import sortBy from 'lodash';\nconsole.log(sortBy([3, 1, 2]));\n"
    );

    await openDependenciesFromShortcut(page);

    await expect(page.getByTestId('dependency-row-lodash')).toBeVisible();
    await expect(page.getByTestId('dependency-status-lodash')).toContainText(
      'Desktop only'
    );
    await expect(page.getByTestId('dependency-install-lodash')).toBeDisabled();
  });

  test('renders the same dependency flow in Spanish', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await enableDependencyDetection(page);
    await gotoApp(page);
    await dismissWhatsNew(page);

    await replaceEditorText(
      page,
      "import sortBy from 'lodash';\nconsole.log(sortBy([3, 1, 2]));\n"
    );

    await openDependenciesFromShortcut(page);

    await expect(page.getByTestId('dependency-row-lodash')).toBeVisible();
    await expect(page.getByTestId('dependency-status-lodash')).toContainText(
      'Solo escritorio'
    );
    await expect(page.getByTestId('dependency-install-lodash')).toContainText(
      'Instala'
    );
  });
});
