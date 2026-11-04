import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

const PASSWORD = 'hunter2-password';
const ROW = 'row-from-the-server';

async function openConnection(page: Page, language: 'en' | 'es'): Promise<string[]> {
  const sent: string[] = [];
  await page.context().route(/neon\.tech\/sql$/, async (route) => {
    const body = route.request().postData() ?? '';
    sent.push(body);
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      body: JSON.stringify(
        /queries/.test(body)
          ? { results: [{ fields: [], rows: [], command: 'SELECT', rowCount: 0 }] }
          : { fields: [{ name: 'v', dataTypeID: 25 }], rows: [[ROW]], command: 'SELECT', rowCount: 1 }
      ),
    });
  });
  await seedSession(page, { language });
  await page.addInitScript(() => {
    const raw = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    raw.state.featureFlags = { dbClient: true };
    localStorage.setItem('lingua-settings', JSON.stringify(raw));
  });
  await gotoApp(page);
  await page.keyboard.press('ControlOrMeta+Alt+S');
  await page.getByTestId('sql-query-list-create').click();
  await page.getByTestId('sql-connection-pill').click();
  await page.getByTestId('sql-connection-new').click();
  const url = page.getByTestId('sql-connection-url');
  await url.fill(`postgres://app:${PASSWORD}@ep-quiet.us-east-1.aws.neon.tech/orders`);
  await expect(url).toHaveValue('postgres://app@ep-quiet.us-east-1.aws.neon.tech/orders');
  await page.getByTestId('sql-connection-save').click();
  await expect(page.getByTestId('sql-connection-pill')).toContainText('orders');
  return sent;
}

async function replaceQuery(page: Page, text: string): Promise<void> {
  await page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor').click({ position: { x: 120, y: 20 } });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(text);
}

const stored = (page: Page) => page.evaluate(() => JSON.stringify({ ...localStorage }));

for (const language of ['en', 'es'] as const) {
  test(`keeps a connection's secrets and rows off disk (${language})`, async ({ page }) => {
    await openConnection(page, language);
    await replaceQuery(page, `ALTER ROLE app PASSWORD '${PASSWORD}'`);
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByTestId('sql-result-preview-row')).toContainText(ROW);
    await expect
      .poll(async () => JSON.parse((await stored(page)))['lingua-workspace-sql-state'] ?? '')
      .toContain('•••');
    const disk = await stored(page);
    expect(disk).not.toContain(PASSWORD);
    expect(disk).not.toContain(ROW);
  });

  test(`refuses to run a masked value on a connection (${language})`, async ({ page }) => {
    const sent = await openConnection(page, language);
    const before = sent.length;
    await replaceQuery(page, "ALTER ROLE app PASSWORD '•••'");
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByText(language === 'en' ? 'still has a masked value' : 'todavía tiene un valor enmascarado')).toBeVisible();
    expect(sent.slice(before).join('')).not.toContain('•••');
  });
}
