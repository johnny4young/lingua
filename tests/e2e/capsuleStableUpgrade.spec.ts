/**
 * Stable-release upgrade journey for Run Capsules.
 *
 * The source artifact is an immutable file captured from the v0.15.0 public
 * contract, not an object built by the current test process. The happy path
 * proves that the current web app still previews it, opens it without silent
 * execution, and restores its named stdin/argv set. The rejection path proves
 * that a genuinely newer schema still receives update guidance.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { CURRENT_RUN_CAPSULE_VERSION } from '../../src/shared/runCapsule';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

const FIXTURE_PATH = path.join(
  process.cwd(),
  'tests/fixtures/capsules/v0.15.0/javascript-input-set.capsule.json'
);
const REVIEW_DIR = 'output/review/capsule-stable-compatibility';

async function openImportOverlay(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Shift+Y');
  await expect(page.getByTestId('capsule-import-overlay')).toBeVisible();
}

async function loadStableFixture(page: Page): Promise<void> {
  await page.getByTestId('capsule-import-file-input').setInputFiles(FIXTURE_PATH);
  await expect(page.getByTestId('capsule-import-preview')).toBeVisible();
  await expect(page.getByTestId('capsule-import-preview-metadata-appversion')).toContainText(
    '0.15.0'
  );
}

test.describe('Run Capsule upgrade from stable v0.15.0', () => {
  test('imports the stable artifact and restores source plus its named input set', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openImportOverlay(page);
    await loadStableFixture(page);

    await expect(page.getByTestId('capsule-import-preview-source-content')).toContainText(
      "const name = process.argv[1] ?? 'friend';"
    );

    if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
      mkdirSync(REVIEW_DIR, { recursive: true });
      await page.screenshot({
        path: `${REVIEW_DIR}/capsule-v015-upgrade-en.png`,
        fullPage: true,
      });
    }

    await page.getByTestId('capsule-import-overlay-confirm').click();
    await expect(page.getByTestId('capsule-import-overlay')).toBeHidden();
    await expect(
      page.getByTestId('editor-tab-activation').filter({ hasText: 'stable-input.js' })
    ).toBeVisible();
    await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('const name');

    await page.keyboard.press('ControlOrMeta+Backslash');
    await page.getByTestId('bottom-panel-stdin-tab').click();
    await expect(page.getByLabel('Select an input set')).toContainText('Stable 0.15 fixture');
    await expect(page.getByRole('textbox', { name: 'Response for call 1' })).toHaveValue(
      'legacy capsule'
    );
    await expect(page.getByLabel('Command arguments')).toHaveValue('Ada');
  });

  test('renders the stable artifact journey in Spanish', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openImportOverlay(page);
    await loadStableFixture(page);

    await expect(page.getByRole('dialog', { name: /importa una cápsula/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Código' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.getByTestId('capsule-import-overlay-confirm')).toHaveText(
      'Abrir como pestaña nueva'
    );

    if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
      mkdirSync(REVIEW_DIR, { recursive: true });
      await page.screenshot({
        path: `${REVIEW_DIR}/capsule-v015-upgrade-es.png`,
        fullPage: true,
      });
    }
  });

  test('keeps update guidance for a capsule produced by a newer schema', async ({ page }) => {
    const newer = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
    newer.version = CURRENT_RUN_CAPSULE_VERSION + 1;

    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openImportOverlay(page);
    await page.getByTestId('capsule-import-paste-textarea').fill(JSON.stringify(newer));

    await expect(page.getByText('This isn’t a valid capsule')).toBeVisible();
    await expect(
      page.getByText(
        'This capsule was produced by a newer version of Lingua. Update the app to open it.'
      )
    ).toBeVisible();
    await expect(page.getByTestId('capsule-import-overlay-confirm')).toBeDisabled();
  });
});
