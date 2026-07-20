/**
 * implementation — e2e for the global Import overlay.
 *
 * Acceptance: Mod+Alt+I opens the Import overlay from anywhere. EN
 * + ES locales render with tuteo copy. The full preview + confirm
 * flow is covered by the component test; the e2e pin focuses on
 * the keyboard binding + the locale-correct title.
 */

import {
  expect,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Import overlay — Mod+Alt+I binding ', () => {
  test('opens via Mod+Alt+I (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+I');

    await expect(page.getByTestId('import-preview-overlay')).toBeVisible();
    await expect(page.getByText(/import data/i)).toBeVisible();
  });

  test('localizes the overlay in Spanish (tuteo)', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+I');

    await expect(page.getByTestId('import-preview-overlay')).toBeVisible();
    await expect(page.getByText(/importa datos/i)).toBeVisible();
  });

  test('pasting a Jupyter `.ipynb` payload previews the notebook (implementation, EN)', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+I');

    const overlay = page.getByTestId('import-preview-overlay');
    await expect(overlay).toBeVisible();

    const ipynbPayload = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { kernelspec: { language: 'python' } },
      cells: [
        { cell_type: 'markdown', source: ['# E2E hello'] },
        { cell_type: 'code', source: ["print('hi')"], outputs: [] },
      ],
    });

    await page.getByTestId('import-preview-paste').fill(ipynbPayload);

    // Notebook preview band lights up with the summary chip + cell snippets.
    await expect(
      page.locator('[data-preview-kind="ipynb-notebook"]')
    ).toBeVisible();
    await expect(
      page.getByTestId('import-preview-notebook-summary')
    ).toContainText(/2 cells/);
    // Confirm button label flips to the notebook variant (implementation note).
    await expect(page.getByTestId('import-preview-confirm')).toContainText(
      /Import as notebook/i
    );
  });

  test('rejects an .ipynb with nbformat 3 with a localized hint (ES tuteo, implementation)', async ({
    page,
  }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+I');

    await page
      .getByTestId('import-preview-paste')
      .fill(JSON.stringify({ nbformat: 3, cells: [] }));

    await expect(page.getByTestId('import-preview-reject')).toBeVisible();
    await expect(
      page.getByTestId('import-preview-reject-detail')
    ).toContainText(/formato v4/i);
  });

  test('pasting a Postman collection previews every request (implementation, EN)', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+I');
    await expect(page.getByTestId('import-preview-overlay')).toBeVisible();

    const postman = JSON.stringify({
      info: {
        name: 'E2E API',
        schema:
          'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        { name: 'List', request: { method: 'GET', url: 'https://x.dev/items' } },
        { name: 'Create', request: { method: 'POST', url: 'https://x.dev/items' } },
      ],
    });
    await page.getByTestId('import-preview-paste').fill(postman);

    await expect(
      page.locator('[data-preview-kind="http-collection"]')
    ).toBeVisible();
    await expect(
      page.getByTestId('import-preview-collection-summary')
    ).toContainText(/2 requests/);
    await expect(page.getByTestId('import-preview-confirm')).toContainText(
      /Import 2 requests/i
    );
  });

  test('confirming a collection lands every request in the stable HTTP workspace rail (implementation / MOV.02, EN)', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+I');
    await expect(page.getByTestId('import-preview-overlay')).toBeVisible();

    // Distinct method + URL per request so the editor binding is unambiguous.
    const postman = JSON.stringify({
      info: {
        name: 'E2E API',
        schema:
          'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        { name: 'List items', request: { method: 'GET', url: 'https://x.dev/list' } },
        {
          name: 'Create item',
          request: { method: 'POST', url: 'https://x.dev/create' },
        },
      ],
    });
    await page.getByTestId('import-preview-paste').fill(postman);
    await page.getByTestId('import-preview-confirm').click();

    // The collection lands as a full-screen HTTP workspace tab: ONE stable
    // FileTab plus a rail listing BOTH requests. (The
    // `http-request-list` id is shared by the resizable Panel wrapper, so we
    // assert on the unambiguous rows + editor instead of the list container.)
    const rows = page.getByTestId('http-request-list-row');
    await expect(rows).toHaveCount(2);
    // The editor is bound to the adopted first request (List, GET).
    await expect(page.getByTestId('http-request-editor-url')).toHaveValue(
      'https://x.dev/list'
    );

    const openFilesTabs = page.getByTestId('editor-tab-activation');
    const tabsBefore = await openFilesTabs.count();

    // Click the OTHER request's rail row. Before the collection rework this
    // was modeled as a per-request FileTab. The current contract keeps one
    // workspace FileTab and re-binds the editor from the in-panel rail.
    await rows.filter({ hasText: 'Create item' }).click();

    await expect(openFilesTabs).toHaveCount(tabsBefore);
    await expect(page.getByTestId('http-request-editor-url')).toHaveValue(
      'https://x.dev/create'
    );
    await expect(page.getByTestId('http-request-editor-method')).toHaveValue(
      'POST'
    );
  });
});
