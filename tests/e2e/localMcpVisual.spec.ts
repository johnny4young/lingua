import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const screenshotDir = path.resolve(process.cwd(), 'output/playwright/local-mcp');

test.describe.configure({ mode: 'serial' });

test.describe('local MCP bilingual evidence', () => {
  test.beforeAll(() => {
    fs.rmSync(screenshotDir, { recursive: true, force: true });
    fs.mkdirSync(screenshotDir, { recursive: true });
  });

  for (const [locale, title, consent, start, ready] of [
    ['en', 'Local MCP server', /I understand this token/, 'Start server', 'Connection ready'],
    ['es', 'Servidor MCP local', /Entiendo que este token/, 'Iniciar servidor', 'Conexión lista'],
  ] as const) {
    test(`${locale} consent and active connection`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const errors: string[] = [];
      page.on('console', message => message.type() === 'error' && errors.push(message.text()));
      page.on('pageerror', error => errors.push(error.message));

      await page.goto(`/?e2e=local-mcp&locale=${locale}`);
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(consent)).toBeVisible();
      const consentPath = path.join(screenshotDir, `local-mcp-consent-${locale}.png`);
      await page.screenshot({ path: consentPath, animations: 'disabled' });
      await testInfo.attach(path.basename(consentPath), {
        path: consentPath,
        contentType: 'image/png',
      });

      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: start }).click();
      await expect(page.getByText(ready)).toBeVisible();
      await expect(page.getByText('http://127.0.0.1:43127/mcp')).toBeVisible();
      const activePath = path.join(screenshotDir, `local-mcp-${locale}.png`);
      await page.screenshot({ path: activePath, animations: 'disabled' });
      await testInfo.attach(path.basename(activePath), {
        path: activePath,
        contentType: 'image/png',
      });
      expect(errors).toEqual([]);
    });
  }
});
