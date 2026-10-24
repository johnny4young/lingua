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
  test(`cancel during a web connection handshake prevents dispatch and permits recovery (${language})`, async ({ page, context }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    const origin = new URL(String(testInfo.project.use.baseURL)).origin;
    // The only database endpoint is intercepted. No real server or credential is used.
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
    const statements: string[] = [];
    let versions = 0;
    await page.route('https://qa.invalid/**', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const body = route.request().postDataJSON() as { requests?: Array<{ stmt?: { sql: string } }> };
      const sql = body.requests?.[0]?.stmt?.sql ?? '';
      statements.push(sql);
      if (sql.includes('sqlite_version') && ++versions === 2) { started(); await gate; }
      const result = sql.includes('sqlite_version')
        ? { cols: [{ name: 'v' }], rows: [[{ type: 'text', value: '3.45.1' }]], affected_row_count: 0 }
        : sql.includes('AS answer')
          ? { cols: [{ name: 'answer', decltype: 'INTEGER' }], rows: [[{ type: 'integer', value: '42' }]], affected_row_count: 0 }
          : { cols: [], rows: [], affected_row_count: 0 };
      await route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(pipeline(result)) });
    });
    const typeSql = async (source: string) => {
      await page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor').click({ position: { x: 120, y: 20 } });
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.insertText(source);
    };
    try {
      await page.goto('/');
      await page.getByTestId('license-badge').waitFor();
      await expect(page.locator('html')).toHaveAttribute('data-theme', language === 'en' ? 'light' : 'dark');
      await page.keyboard.press('ControlOrMeta+Alt+S');
      await page.getByTestId('sql-query-list-create').click();
      await typeSql('SELECT 13 AS cancelled_value');
      await page.getByTestId('sql-connection-pill').click();
      await page.getByTestId('sql-connection-new').click();
      await page.getByTestId('sql-connection-name').fill('Synthetic connection');
      await page.getByTestId('sql-connection-host').fill('qa.invalid');
      await page.getByTestId('sql-connection-password').fill('synthetic-token');
      await page.getByTestId('sql-connection-save').click();
      await page.getByTestId('sql-connection-sheet').waitFor({ state: 'hidden' });
      await expect.poll(() => versions).toBe(1);
      await page.getByTestId('sql-query-editor-run').click();
      await handshakeStarted;
      await page.getByTestId('sql-query-editor-cancel').click();
      release();
      await expect(page.getByTestId('sql-status-pill')).toHaveAttribute('data-status', 'cancelled');
      await testInfo.attach(`cancelled-${language}`, { body: await page.screenshot(), contentType: 'image/png' });
      await typeSql('SELECT 42 AS answer');
      await page.getByTestId('sql-query-editor-run').click();
      await expect(page.getByTestId('sql-result-preview-row').first()).toContainText('42');
      expect(statements).not.toContain('SELECT 13 AS cancelled_value');
      expect(statements).toContain('SELECT 42 AS answer');
      await testInfo.attach(`recovered-${language}`, { body: await page.screenshot(), contentType: 'image/png' });
      expect(errors).toEqual([]);
    } finally { release(); }
  });
}
