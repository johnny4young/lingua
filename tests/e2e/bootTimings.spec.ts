import { mkdirSync } from 'node:fs';
import {
  expect,
  gotoApp,
  openCommandPalette,
  paletteInput,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe('boot timings — internal', () => {
  test('publishes DevTools marks and copies duration-only JSON', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await expect
      .poll(() =>
        page.evaluate(() =>
          performance
            .getEntriesByType('mark')
            .filter((entry) => entry.name.startsWith('lingua:boot:'))
            .map((entry) => entry.name)
        )
      )
      .toEqual([
        'lingua:boot:start',
        'lingua:boot:system-language',
        'lingua:boot:i18n',
        'lingua:boot:react-mount',
        'lingua:boot:first-paint',
        'lingua:boot:rehydration',
      ]);

    await openCommandPalette(page);
    await paletteInput(page).fill('boot timings');
    const command = page.getByRole('option', { name: /Copy boot timings/i });
    await expect(command).toBeVisible();
    if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
      mkdirSync('output/review/project-sequence/t05-boot-timings', { recursive: true });
      await page.screenshot({
        path: 'output/review/project-sequence/t05-boot-timings/web-en-palette-command.png',
      });
    }
    await command.click();
    await expect(page.getByText('Boot timings copied to the clipboard.')).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    const snapshot = JSON.parse(clipboard) as {
      version: number;
      totalDurationMs: number;
      phases: Array<{ phase: string; durationMs: number }>;
    };
    expect(snapshot.version).toBe(1);
    expect(snapshot.phases.map((entry) => entry.phase)).toEqual([
      'system-language',
      'i18n',
      'react-mount',
      'first-paint',
      'rehydration',
    ]);
    expect(snapshot.phases.every((entry) => entry.durationMs >= 0)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/timestamp|path|locale|user/iu);
  });

  test('localizes the palette command and success notice in Spanish', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openCommandPalette(page);
    await paletteInput(page).fill('arranque');
    const command = page.getByRole('option', { name: /Copiar tiempos de arranque/i });
    await expect(command).toBeVisible();
    if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
      mkdirSync('output/review/project-sequence/t05-boot-timings', { recursive: true });
      await page.screenshot({
        path: 'output/review/project-sequence/t05-boot-timings/web-es-palette-command.png',
      });
    }
    await command.click();
    await expect(page.getByText('Tiempos de arranque copiados al portapapeles.')).toBeVisible();
  });
});
