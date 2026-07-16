import { mkdirSync } from 'node:fs';
import {
  closeSettings,
  expect,
  gotoApp,
  openCommandPalette,
  openConsole,
  openSettings,
  paletteInput,
  seedSession,
  test,
} from './licenseWeb.helpers';

const evidenceDir = 'output/review/d4-d5-d7-discoverability';

function captureEnabled(): boolean {
  return process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1';
}

test.describe('IT2-D7 contextual empty-state hints', () => {
  test('shows English web-safe hints and disables both surfaces from either one', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openConsole(page);
    await page.getByRole('button', { name: 'Clear console' }).click();

    const consoleHint = page.getByTestId('contextual-hint-console');
    await expect(consoleHint).toBeVisible();
    await expect(consoleHint).toContainText('Tip');

    if (captureEnabled()) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: `${evidenceDir}/d7-web-en-console-hint.png`,
        animations: 'disabled',
      });
    }

    await openCommandPalette(page);
    await paletteInput(page).fill('zzzzzzzz-no-such-command');
    const paletteHint = page.getByTestId('contextual-hint-palette');
    await expect(paletteHint).toBeVisible();
    await expect(paletteHint).not.toContainText(/native toolchain|multi-file template/i);

    if (captureEnabled()) {
      await page.screenshot({
        path: `${evidenceDir}/d7-web-en-palette-hint.png`,
        animations: 'disabled',
      });
    }

    await paletteHint.getByRole('button', { name: "Don't show tips" }).click();
    await expect(paletteHint).toHaveCount(0);
    await expect(consoleHint).toHaveCount(0);
  });

  test('persists the Spanish opt-out and can re-enable hints from Settings', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openConsole(page);
    await page.getByRole('button', { name: 'Limpiar consola' }).click();

    const consoleHint = page.getByTestId('contextual-hint-console');
    await expect(consoleHint).toContainText('Consejo');
    await consoleHint.getByRole('button', { name: 'No mostrar consejos' }).click();
    await expect(consoleHint).toHaveCount(0);

    await openSettings(page);
    const toggle = page.getByRole('switch', { name: 'Mostrar consejos contextuales' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    if (captureEnabled()) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: `${evidenceDir}/d7-web-es-hints-opt-out.png`,
        animations: 'disabled',
      });
    }

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await closeSettings(page);
    await page.getByRole('button', { name: 'Limpiar consola' }).click();
    await expect(page.getByTestId('contextual-hint-console')).toContainText('Consejo');

    await openCommandPalette(page);
    await paletteInput(page).fill('zzzzzzzz-sin-comando');
    await expect(page.getByTestId('contextual-hint-palette')).toContainText('Consejo');
  });
});
