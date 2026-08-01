import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { buildCapsuleWorkspace } from '../../src/shared/capsuleWorkspace';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';
import { auditA11y } from './a11y.helpers';
import {
  clickRun,
  createJavaScriptTab,
  createTypeScriptTab,
  dismissWhatsNew,
  expect,
  expectTier,
  gotoApp,
  seedSession,
  test,
  waitForRunCompleted,
} from './licenseWeb.helpers';

const REVIEW_DIR = 'output/review/capsule-workspace';

async function replaceActiveSource(page: Page, source: string): Promise<void> {
  await page
    .locator('.monaco-editor')
    .first()
    .click({ position: { x: 140, y: 42 } });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(source);
}

async function captureDialog(page: Page, name: RegExp, fileName: string): Promise<void> {
  if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT !== '1') return;
  mkdirSync(REVIEW_DIR, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('dialog', { name }).screenshot({
    path: `${REVIEW_DIR}/${fileName}`,
  });
}

test.describe('Capsule Workspace handoff', () => {
  test('exports only explicitly reviewed open tabs in English', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await expectTier(page, 'PRO');
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await replaceActiveSource(
      page,
      'const total = [20, 22].reduce((a, b) => a + b, 0);\nconsole.log(total);'
    );
    await clickRun(page);
    await waitForRunCompleted(page);
    await expect(page.getByTestId('recent-runs-pill')).toBeVisible();

    await createTypeScriptTab(page);
    await replaceActiveSource(
      page,
      'export const formatTotal = (value: number) => `Total: ${value}`;'
    );
    await page.getByTestId('action-pill-browse-capsules').click();
    await expect(page.getByRole('dialog', { name: /run capsules/i })).toBeVisible();
    await page.getByTestId('capsule-list-row-create-workspace').first().click();

    const dialog = page.getByRole('dialog', { name: /create capsule workspace/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Local-only export\./i)).toBeVisible();
    await dialog.getByTestId('capsule-workspace-candidate').getByRole('checkbox').check();
    await dialog.getByTestId('capsule-workspace-review-confirmation').check();
    await expect(dialog.getByTestId('capsule-workspace-copy')).toBeEnabled();
    await auditA11y(page);
    await dialog.locator('[data-modal-scroll-region]').evaluate(element => {
      element.scrollTop = 0;
    });
    await captureDialog(page, /create capsule workspace/i, 'capsule-workspace-export-en.png');

    await dialog.getByTestId('capsule-workspace-copy').click();
    await expect(dialog.getByTestId('capsule-workspace-message')).toContainText('copied');
    const exported = await page.evaluate(() => navigator.clipboard.readText());
    expect(exported).toContain('lingua-capsule-workspace');
    expect(exported).toContain('formatTotal');
    expect(exported).not.toContain('/Users/');
  });

  test('previews supplemental files inertly in Spanish', async ({ page }) => {
    const built = await buildCapsuleWorkspace(
      FIXTURE_MINIMAL_JS,
      [
        { path: 'src/ayuda.ts', language: 'typescript', content: 'export const respuesta = 42;' },
        { path: 'NOTAS.md', language: 'markdown', content: '# Revisa antes de ejecutar' },
      ],
      Date.parse('2026-08-01T00:00:00.000Z')
    );
    if (!built.ok) throw new Error(built.reason);

    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+Shift+Y');
    await page.getByTestId('capsule-import-paste-textarea').fill(built.json);
    await page.getByTestId('capsule-import-preview-tab-files').click();
    await expect(page.getByTestId('capsule-workspace-viewer-content')).toContainText(
      'export const respuesta = 42;'
    );
    await page.getByTestId('capsule-workspace-viewer-file').filter({ hasText: 'NOTAS.md' }).click();
    await expect(page.getByTestId('capsule-workspace-viewer-content')).toContainText(
      'Revisa antes de ejecutar'
    );
    await auditA11y(page);
    await captureDialog(page, /importa una cápsula/i, 'capsule-workspace-viewer-es.png');

    await page.getByTestId('capsule-workspace-viewer-open-file').click();
    await expect(page.getByTestId('status-notice-banner')).toContainText(
      'Abrí NOTAS.md como una pestaña inerte'
    );
    await expect(
      page.getByTestId('editor-tab-activation').filter({ hasText: 'NOTAS.md' })
    ).toBeVisible();
  });

  test('rejects a workspace that leaks an absolute path before rendering files', async ({
    page,
  }) => {
    const built = await buildCapsuleWorkspace(FIXTURE_MINIMAL_JS, [
      { path: 'src/helper.ts', language: 'typescript', content: 'export {};' },
    ]);
    if (!built.ok) throw new Error(built.reason);
    const tampered = JSON.parse(built.json) as { files: Array<{ path: string }> };
    tampered.files[0]!.path = '/Users/private/helper.ts';

    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+Shift+Y');
    await page.getByTestId('capsule-import-paste-textarea').fill(JSON.stringify(tampered));
    await expect(page.getByTestId('capsule-import-reject')).toHaveAttribute(
      'data-reason',
      'invalid-shape'
    );
    await expect(page.getByTestId('capsule-import-overlay-confirm')).toBeDisabled();
    await auditA11y(page);
    await captureDialog(page, /import a capsule/i, 'capsule-workspace-rejected-en.png');
  });
});
