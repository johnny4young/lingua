import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const appVersion = (JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version;
const headers = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type,authorization',
};
const pipeline = (result: unknown) => ({ baton: null, base_url: null, results: [
  { type: 'ok', response: { type: 'execute', result } }, { type: 'ok', response: { type: 'close' } },
] });

test.describe.configure({ mode: 'serial' });
for (const language of ['en', 'es'] as const) {
  test(`late catalog refusal preserves the replacement credential (${language})`, async ({ page, context }, testInfo) => {
    const unexpectedErrors: string[] = [];
    page.on('pageerror', (error) => unexpectedErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // These HTTP 401s are deliberately injected by this test, never an app exception.
      if (message.location().url.startsWith('https://qa.invalid/') && /401/.test(message.text())) return;
      unexpectedErrors.push(message.text());
    });
    const origin = new URL(String(testInfo.project.use.baseURL)).origin;
    await context.route('**/*', async (route) => {
      if (route.request().url().startsWith(`${origin}/`)) return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ version: appVersion }) });
    });
    await context.addInitScript(({ language, appVersion }) => {
      Object.defineProperty(navigator, 'clipboard', { value: {
        readText: async () => { throw new Error('Test clipboard disabled'); },
        writeText: async () => { throw new Error('Test clipboard disabled'); },
      } });
      localStorage.setItem('lingua-settings', JSON.stringify({ state: {
        language, lastSeenVersion: appVersion, suppressTourAutoStart: true,
        hasCompletedOnboardingFirstRun: true, hasCompletedOnboardingFirstSnippet: true,
        telemetryConsent: 'declined', restoreSessionMode: 'never',
        theme: language === 'en' ? 'light' : 'dark',
        editorTheme: language === 'en' ? 'lingua-light' : 'lingua-dark', featureFlags: { dbClient: true },
      }, version: 3 }));
    }, { language, appVersion });
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const handshakeStarted = new Promise<void>((done) => { started = done; });
    const statements: Array<{ sql: string; credential: 'old' | 'new' }> = [];
    let oldVersions = 0;
    await page.route('https://qa.invalid/**', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const body = route.request().postDataJSON() as { requests?: Array<{ stmt?: { sql: string } }> };
      const sql = body.requests?.[0]?.stmt?.sql ?? '';
      const credential = route.request().headers().authorization === 'Bearer synthetic-old' ? 'old' : 'new';
      statements.push({ sql, credential });
      if (credential === 'old') {
        if (sql.includes('sqlite_version') && ++oldVersions === 1) { started(); await gate; }
        return route.fulfill({ status: 401, headers, body: 'synthetic old credential refused' });
      }
      const result = sql.includes('sqlite_version')
        ? { cols: [{ name: 'v' }], rows: [[{ type: 'text', value: '3.45.1' }]], affected_row_count: 0 }
        : sql.includes('42')
          ? { cols: [{ name: 'answer', decltype: 'INTEGER' }], rows: [[{ type: 'integer', value: '42' }]], affected_row_count: 0 }
          : { cols: [], rows: [], affected_row_count: 0 };
      await route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(pipeline(result)) });
    });
    try {
      await page.goto('/');
      await page.getByTestId('license-badge').waitFor();
      await expect(page.locator('html')).toHaveAttribute('data-theme', language === 'en' ? 'light' : 'dark');
      await page.keyboard.press('ControlOrMeta+Alt+S');
      await page.getByTestId('sql-query-list-create').click();
      await page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor').click({ position: { x: 120, y: 20 } });
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.insertText('SELECT 42 AS answer');
      await page.getByTestId('sql-connection-pill').click();
      await page.getByTestId('sql-connection-new').click();
      await page.getByTestId('sql-connection-name').fill('Synthetic connection');
      await page.getByTestId('sql-connection-host').fill('qa.invalid');
      await page.getByTestId('sql-connection-password').fill('synthetic-old');
      await page.getByTestId('sql-connection-save').click();
      await page.getByTestId('sql-connection-sheet').waitFor({ state: 'hidden' });
      await handshakeStarted;
      await page.getByTestId('sql-query-editor-run').click();
      await page.getByTestId('sql-password-input').fill('synthetic-new');
      await page.getByTestId('sql-password-connect').click();
      await expect(page.getByTestId('sql-result-preview-row').first()).toContainText('42');
      await testInfo.attach(`replacement-working-${language}`, { body: await page.screenshot(), contentType: 'image/png' });
      release();
      // Wait for the late response to reach the Explorer before testing the next run.
      await expect(page.getByTestId('sql-remote-error').first()).toBeVisible();
      await expect(page.getByTestId('sql-remote-enter-password')).toHaveCount(0);
      await page.getByTestId('sql-query-editor-run').click();
      await expect.poll(() => statements.filter((s) => s.credential === 'new' && s.sql === 'SELECT 42 AS answer').length).toBe(2);
      await expect(page.getByTestId('sql-password-input')).toHaveCount(0);
      await expect(page.getByTestId('sql-status-pill')).toHaveAttribute('data-status', 'success');
      await testInfo.attach(`replacement-retained-${language}`, { body: await page.screenshot(), contentType: 'image/png' });
      expect(unexpectedErrors).toEqual([]);
    } finally { release(); }
  });
}
