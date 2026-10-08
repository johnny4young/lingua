import type { Page } from '@playwright/test';
import {
  expect,
  gotoApp,
  openConsole,
  openSettings,
  seedSession,
  test,
  waitForInitialAutoRunCompleted,
} from './licenseWeb.helpers';

async function edit(page: Page, source: string) {
  await page
    .locator('.monaco-editor')
    .first()
    .click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(source);
}

for (const language of ['en', 'es'] as const) {
  test(`tour explains automatic runs and leaves console feedback clear (${language})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1180, height: 757 });
    await seedSession(page, { language });
    await gotoApp(page);
    await openConsole(page);
    await waitForInitialAutoRunCompleted(page);
    await openSettings(page);
    await page.getByTestId('about-start-tour').click();
    const dialog = page.locator('.guided-tour-step');
    await expect(dialog).toContainText(language === 'en' ? 'automatically' : 'automáticamente');
    await dialog
      .getByRole('button', { name: language === 'en' ? 'Next' : 'Siguiente', exact: true })
      .click();
    await expect(dialog).toContainText(language === 'en' ? 'automatically' : 'automáticamente');
    await dialog
      .getByRole('button', {
        name: language === 'en' ? 'Run sample' : 'Ejecutar ejemplo',
        exact: true,
      })
      .click();
    await expect(dialog.getByRole('heading')).toHaveText(
      language === 'en' ? 'Console feedback' : 'Feedback de la consola'
    );
    await expect(page.locator('.guided-tour-overlay')).toHaveAttribute('data-spotlight', 'true');
    await expect
      .poll(() =>
        page
          .locator('.guided-tour-overlay')
          .evaluate(node => getComputedStyle(node).backgroundColor)
      )
      .toBe('rgba(0, 0, 0, 0)');
    const consolePanel = page.locator('#guided-tour-console');
    await expect
      .poll(async () => {
        const card = await dialog.boundingBox();
        const output = await consolePanel.boundingBox();
        return card && output ? card.y + card.height <= output.y : false;
      })
      .toBe(true);
    await page.screenshot({ path: test.info().outputPath(`first-use-console-${language}.png`) });
    // Back/forward and Escape retain the existing dismissal/focus contract.
    await dialog
      .getByRole('button', { name: language === 'en' ? 'Back' : 'Atrás', exact: true })
      .click();
    await expect(dialog.getByRole('heading')).toHaveText(
      language === 'en' ? 'Run the active file' : 'Ejecuta el archivo activo'
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.guided-tour-spotlight')).toHaveCount(0);
  });

  test(`a newer overlay cancels a slow first tour load and explicit retry works (${language})`, async ({
    page,
  }) => {
    await seedSession(page, { language });
    await gotoApp(page);
    await openConsole(page);
    await waitForInitialAutoRunCompleted(page);
    await openSettings(page);

    let releaseChunk!: () => void;
    const released = new Promise<void>(resolve => {
      releaseChunk = resolve;
    });
    let sawRequest!: () => void;
    const requested = new Promise<void>(resolve => {
      sawRequest = resolve;
    });
    const runtimeUrl = /\/GuidedTourRuntime-[^/]+\.js(?:\?|$)/;
    await page.route(runtimeUrl, async route => {
      sawRequest();
      await released;
      await route.continue();
    });
    const response = page.waitForResponse(runtimeUrl);
    await page.getByTestId('about-start-tour').click();
    try {
      await requested;
      // The source Settings closes before the deferred chunk is available.
      await expect(page.getByTestId('about-start-tour')).toHaveCount(0);
      await openSettings(page);
    } finally {
      releaseChunk();
    }
    await (await response).finished();
    // Negative observation: allow the late module and React effects to settle.
    await page.waitForTimeout(500);
    await expect(page.getByTestId('about-start-tour')).toBeVisible();
    await expect(page.locator('.guided-tour-step')).toHaveCount(0);

    await page.getByTestId('about-start-tour').click();
    await expect(page.locator('.guided-tour-step')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Comma');
    await expect(page.getByTestId('about-start-tour')).toBeVisible();
    await expect(page.locator('.guided-tour-step')).toHaveCount(0);
    await expect
      .poll(() =>
        page.getByRole('dialog').evaluate(dialog => dialog.contains(document.activeElement))
      )
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.unroute(runtimeUrl);
  });

  test(`long source errors reserve a separate result row and recover (${language})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 757 });
    await seedSession(page, { language, workflowModeDefaultsByLanguage: { javascript: 'run' } });
    await gotoApp(page);
    await openConsole(page);
    const marker = 'first-use-long-source-' + 'x'.repeat(100);
    await edit(page, `throw new Error("${marker}");`);
    await page.getByTestId('action-pill-run').click();
    const widget = page
      .getByTestId('lingua-inline-result')
      .filter({ hasText: 'first-use-long-source' });
    await expect(widget).toBeVisible();
    await expect
      .poll(async () => {
        const result = await widget.boundingBox();
        const source = await page
          .locator('.monaco-editor .view-line')
          .filter({ hasText: 'throw new Error' })
          .first()
          .boundingBox();
        return result && source ? result.y >= source.y + source.height : false;
      })
      .toBe(true);
    await page.screenshot({ path: test.info().outputPath(`first-use-inline-${language}.png`) });
    await expect(page.getByTestId('action-pill-run')).toHaveAttribute('data-running', 'false');
    await edit(page, 'console.log("first-use-recovered")');
    await page.getByTestId('action-pill-run').click();
    await expect(
      page.getByTestId('console-entry-row').filter({ hasText: 'first-use-recovered' })
    ).toHaveCount(1);
    await expect(widget).toHaveCount(0);
  });
}
