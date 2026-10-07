import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  expect,
  gotoApp,
  openCommandPalette,
  openConsole,
  openSettings,
  openSettingsTab,
  paletteInput,
  seedSession,
  test,
} from './licenseWeb.helpers';

// Source evidence for website/public/screenshots/tour (see tour-showcase.json).
const screenshotDir = path.resolve(process.cwd(), 'output/playwright/tour');
const RELEASES_CSV = [
  'version,date,channel,features,fixes',
  '1.5.1,2026-09-29,stable,4,11',
  '1.5.0,2026-09-16,stable,9,23',
  '1.4.1,2026-09-02,stable,2,8',
  '1.4.0,2026-08-26,stable,12,19',
  '1.3.0,2026-08-12,stable,7,15',
  '1.2.0,2026-07-29,stable,10,12',
  '1.1.0,2026-07-15,beta,6,9',
  '1.0.0,2026-08-03,stable,14,30',
  '',
].join('\n');
const PYTHON_SOURCE = [
  'from statistics import mean',
  '',
  'latencies = {"api": [38, 41, 35], "worker": [12, 14, 11], "db": [92, 88, 97]}',
  'averages = {name: round(mean(samples), 1) for name, samples in latencies.items()}',
  'bars = {name: "#" * round(avg / 4) for name, avg in averages.items()}',
  '',
  'rows = [f"{name:<8}{bars[name]} {averages[name]}ms" for name in averages]',
  'print("\\n".join(rows))',
  '',
  'slowest = max(averages, key=averages.get)',
  'print(f"slowest path: {slowest}")',
].join('\n');

test.describe.configure({ mode: 'serial' });
test.use({ timezoneId: 'UTC' });

async function prepare(page: Page, language: 'en' | 'es'): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedSession(page, { language });
  await page.addInitScript(() => {
    (window as { __linguaE2eFixedDurationMs?: number }).__linguaE2eFixedDurationMs = 12;
    // Seeded UUIDs keep generated tab names identical across captures.
    let seed = 0x9e3779b9;
    const nextByte = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) & 0xff;
    };
    crypto.randomUUID = () => {
      const bytes = Array.from({ length: 16 }, nextByte);
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = bytes.map(byte => byte.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`;
    };
  });
  await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));
  await page.context().route('https://api.example.dev/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        items: [
          { id: 101, name: 'runtime', status: 'healthy', p95Ms: 118 },
          { id: 102, name: 'editor', status: 'healthy', p95Ms: 64 },
        ],
        page: 1,
        total: 2,
      }),
    })
  );
  await gotoApp(page);
}

async function dismissNotices(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: /^(Dismiss notice|Descartar aviso)$/ });
  while (await dismiss.first().isVisible().catch(() => false)) await dismiss.first().click();
}

async function hideConsole(page: Page): Promise<void> {
  if (await page.getByTestId('execution-history-toggle').isVisible().catch(() => false)) {
    await page.keyboard.press('ControlOrMeta+Backslash');
  }
}

async function capture(page: Page, file: string): Promise<void> {
  await dismissNotices(page);
  await page.mouse.move(1430, 890);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(screenshotDir, file), animations: 'disabled' });
}

async function replaceEditorText(page: Page, text: string): Promise<void> {
  const editor = page.locator('.monaco-editor').first();
  await editor.click({ position: { x: 120, y: 30 } });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
}

test.describe('website tour evidence', () => {
  test.beforeAll(() => {
    fs.rmSync(screenshotDir, { recursive: true, force: true });
    fs.mkdirSync(screenshotDir, { recursive: true });
  });

  for (const language of ['en', 'es'] as const) {
    test(`${language} tour surfaces`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await prepare(page, language);

      // Python scratchpad with inline values and console output.
      await page.getByRole('button', { name: 'JavaScript', exact: true }).first().click();
      await page
        .locator('[role=menu] [role^=menuitem], [role=listbox] [role=option]')
        .filter({ hasText: 'Python' })
        .first()
        .click();
      await replaceEditorText(page, PYTHON_SOURCE);
      await expect(page.getByText('slowest path: db').first()).toBeVisible({ timeout: 60_000 });
      await openConsole(page);
      await expect(page.getByText(/slowest path: db'/).first()).toBeVisible();
      await capture(page, `workspace-python-${language}.png`);

      // Command palette filtered to sql.
      await openCommandPalette(page);
      await paletteInput(page).fill('sql');
      const palette = page.getByRole('dialog').first();
      await expect(palette.getByRole('option').first()).toBeVisible();
      await page.mouse.move(1430, 890);
      await palette.screenshot({ path: path.join(screenshotDir, `command-palette-${language}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');

      // Settings → Privacy.
      await openSettings(page);
      await openSettingsTab(page, 'privacy');
      await capture(page, `settings-privacy-${language}.png`);
      await page.keyboard.press('Escape');

      // Developer utilities: JSON formatter with a pretty-printed payload.
      await page.keyboard.press('ControlOrMeta+K');
      await expect(page.getByTestId('developer-utilities-workspace')).toBeVisible();
      await page.getByRole('button', { name: /^(JSON Formatter|Formateador JSON)/ }).first().click();
      const input = page.locator('textarea').first();
      await input.fill(
        JSON.stringify({
          release: { version: '1.5.1', channels: ['web', 'desktop', 'cli'], signed: true },
          metrics: { p50Ms: 41, p95Ms: 118, runs: 1287 },
          owners: [{ name: 'runtime', oncall: true }, { name: 'editor', oncall: false }],
        })
      );
      await page.getByRole('button', { name: /^(Pretty print|Formatear)$/ }).click();
      await capture(page, `utilities-${language}.png`);

      // HTTP workspace: GET with query params against a local fixture.
      await page.keyboard.press('ControlOrMeta+Shift+K');
      await page.getByTestId('http-workspace-empty-create').click();
      await page.getByTestId('http-request-editor-url').fill(
        'https://api.example.dev/v1/services?status=healthy&limit=2'
      );
      await page.getByTestId('http-request-editor-send').click();
      await expect(page.getByText('200 OK').first()).toBeVisible();
      await capture(page, `http-workspace-${language}.png`);

      // SQL workspace: imported CSV, formatted aggregate query, column profile.
      await page.keyboard.press('ControlOrMeta+Alt+S');
      await hideConsole(page);
      await page.getByTestId('sql-workspace-empty-import-input').setInputFiles({
        name: 'releases.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(RELEASES_CSV),
      });
      await page.getByTestId('sql-import-modal-confirm').click();
      await page.getByTestId('sql-query-list-create').click();
      await replaceEditorText(
        page,
        'SELECT channel, count(*) AS releases, sum(features) AS features, sum(fixes) AS fixes, max(date) AS latest FROM releases GROUP BY channel ORDER BY releases DESC'
      );
      await page.getByTestId('sql-query-editor-format').click();
      await page.getByTestId('sql-query-editor-run').click();
      await page.getByRole('button', { name: /(Show columns for|Muestra las columnas de) releases/ }).click();
      await page.getByTestId('sql-result-preview-profile').click();
      await expect(page.getByTestId('sql-column-profile-panel')).toBeVisible();
      await capture(page, `sql-workspace-${language}.png`);

      expect(errors).toEqual([]);
    });
  }
});
