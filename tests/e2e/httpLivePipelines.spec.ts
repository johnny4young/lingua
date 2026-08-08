import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  expect,
  gotoApp,
  seedSession,
  test,
  waitForSeededWorkspaceSettled,
} from './licenseWeb.helpers';

const screenshotDir = path.resolve(process.cwd(), 'output/playwright/http-live-pipelines');

test.describe.configure({ mode: 'serial' });

async function renameActiveRequest(page: Page, name: string): Promise<void> {
  const activeRow = page.locator('[data-testid="http-request-list-row"][data-active="true"]');
  await activeRow.getByTestId('http-request-list-rename').click();
  const input = activeRow.getByTestId('http-request-list-rename-input');
  await input.fill(name);
  await input.press('Enter');
  await expect(activeRow).toContainText(name);
}

async function createRequest(
  page: Page,
  options: { name: string; transport: 'http' | 'sse' | 'websocket'; url: string }
): Promise<void> {
  const create = page.getByTestId('http-request-list-create');
  if (await create.isVisible().catch(() => false)) await create.click();
  else await page.getByTestId('http-workspace-empty-create').click();

  await renameActiveRequest(page, options.name);
  await page.getByTestId('http-request-editor-transport').selectOption(options.transport);
  await page.getByTestId('http-request-editor-url').fill(options.url);
  await expect(page.getByTestId('http-request-editor-url')).toHaveValue(options.url);
  await expect(
    page
      .locator('[data-testid="http-request-list-row"][data-active="true"]')
      .getByTestId('http-request-list-row-method')
  ).toHaveText(
    options.transport === 'websocket' ? 'WS' : options.transport === 'sse' ? 'SSE' : 'GET'
  );
}

test.beforeAll(() => {
  fs.rmSync(screenshotDir, { recursive: true, force: true });
  fs.mkdirSync(screenshotDir, { recursive: true });
});

test('shows live transports, the browser safety boundary, and pipelines in English', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Pin every measured duration the UI would render (cell badges, response
  // meta). Real runs cannot reproduce their own wall-clock numbers, and this
  // capture must be byte-identical across runs. See testing/e2eDurations.ts.
  await page.addInitScript(() => {
    (window as { __linguaE2eFixedDurationMs?: number }).__linguaE2eFixedDurationMs = 12;
  });
  await seedSession(page, { language: 'en' });
  await gotoApp(page);
  await waitForSeededWorkspaceSettled(page);
  await page.keyboard.press('ControlOrMeta+Shift+K');
  await expect(page.getByTestId('http-workspace-panel')).toBeVisible();

  await createRequest(page, {
    name: 'Health check',
    transport: 'http',
    url: 'https://api.example.com/health',
  });
  await createRequest(page, {
    name: 'Events stream',
    transport: 'sse',
    url: 'https://api.example.com/events',
  });
  await createRequest(page, {
    name: 'Realtime chat',
    transport: 'websocket',
    url: 'wss://echo.websocket.events',
  });

  await page.getByTestId('http-request-editor-tab-headers').click();
  await page.getByTestId('http-request-editor-headers-add').click();
  await page.getByTestId('http-request-editor-header-name').fill('X-Trace');
  await page.getByTestId('http-request-editor-header-value').fill('review');
  await page.getByTestId('http-request-editor-send').click();
  await expect(page.getByTestId('http-response-preview-error')).toContainText(
    'Custom WebSocket headers require Lingua Desktop'
  );

  const editorPath = path.join(screenshotDir, 'http-live-transports-en.png');
  // Park the pointer and drop focus before capturing: Playwright leaves the
  // virtual mouse wherever the last click landed, so a toolbar button can be
  // captured with its hover/focus styling half-applied — measured as a
  // handful of border pixels flipping between runs on the Run all pill.
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      // Two frames: Monaco hides its caret on the next paint, and a capture
      // taken in between kept a one-pixel antialiased remnant of it.
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
  await page.screenshot({ path: editorPath, fullPage: false, animations: 'disabled' });
  await testInfo.attach('http-live-transports-en.png', {
    path: editorPath,
    contentType: 'image/png',
  });

  await page.getByTestId('http-pipeline-open').click();
  await page.getByRole('button', { name: 'New pipeline' }).first().click();
  await page.getByRole('textbox', { name: 'Pipeline name' }).fill('Release smoke');
  await page.getByRole('combobox', { name: 'Add request' }).selectOption({
    label: 'Health check',
  });
  await expect(page.getByTestId('http-pipeline-manager')).toContainText('Health check');

  const pipelinePath = path.join(screenshotDir, 'http-pipeline-en.png');
  // Park the pointer and drop focus before capturing: Playwright leaves the
  // virtual mouse wherever the last click landed, so a toolbar button can be
  // captured with its hover/focus styling half-applied — measured as a
  // handful of border pixels flipping between runs on the Run all pill.
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      // Two frames: Monaco hides its caret on the next paint, and a capture
      // taken in between kept a one-pixel antialiased remnant of it.
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
  await page.screenshot({ path: pipelinePath, fullPage: false, animations: 'disabled' });
  await testInfo.attach('http-pipeline-en.png', {
    path: pipelinePath,
    contentType: 'image/png',
  });
});

test('localizes the live HTTP and pipeline surfaces in Spanish', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Pin every measured duration the UI would render (cell badges, response
  // meta). Real runs cannot reproduce their own wall-clock numbers, and this
  // capture must be byte-identical across runs. See testing/e2eDurations.ts.
  await page.addInitScript(() => {
    (window as { __linguaE2eFixedDurationMs?: number }).__linguaE2eFixedDurationMs = 12;
  });
  await seedSession(page, { language: 'es' });
  await gotoApp(page);
  await waitForSeededWorkspaceSettled(page);
  await page.keyboard.press('ControlOrMeta+Shift+K');

  await createRequest(page, {
    name: 'Estado de la API',
    transport: 'http',
    url: 'https://api.example.com/health',
  });
  await createRequest(page, {
    name: 'Eventos en vivo',
    transport: 'sse',
    url: 'https://api.example.com/events',
  });
  await expect(page.getByTestId('http-request-editor-transport')).toHaveValue('sse');

  const editorPath = path.join(screenshotDir, 'http-live-transports-es.png');
  // Park the pointer and drop focus before capturing: Playwright leaves the
  // virtual mouse wherever the last click landed, so a toolbar button can be
  // captured with its hover/focus styling half-applied — measured as a
  // handful of border pixels flipping between runs on the Run all pill.
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      // Two frames: Monaco hides its caret on the next paint, and a capture
      // taken in between kept a one-pixel antialiased remnant of it.
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
  await page.screenshot({ path: editorPath, fullPage: false, animations: 'disabled' });
  await testInfo.attach('http-live-transports-es.png', {
    path: editorPath,
    contentType: 'image/png',
  });

  await page.getByTestId('http-pipeline-open').click();
  await page.getByRole('button', { name: 'Nuevo pipeline' }).first().click();
  await page.getByRole('textbox', { name: 'Nombre del pipeline' }).fill('Validación local');
  await page.getByRole('combobox', { name: 'Agregar solicitud' }).selectOption({
    label: 'Estado de la API',
  });
  await expect(page.getByTestId('http-pipeline-manager')).toContainText(
    'Listo para ejecutar localmente'
  );

  const pipelinePath = path.join(screenshotDir, 'http-pipeline-es.png');
  // Park the pointer and drop focus before capturing: Playwright leaves the
  // virtual mouse wherever the last click landed, so a toolbar button can be
  // captured with its hover/focus styling half-applied — measured as a
  // handful of border pixels flipping between runs on the Run all pill.
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      // Two frames: Monaco hides its caret on the next paint, and a capture
      // taken in between kept a one-pixel antialiased remnant of it.
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
  await page.screenshot({ path: pipelinePath, fullPage: false, animations: 'disabled' });
  await testInfo.attach('http-pipeline-es.png', {
    path: pipelinePath,
    contentType: 'image/png',
  });
});
