/**
 * Pick up rows keep every name readable at phone and tablet widths: a row
 * stacks its answer under the name instead of squeezing the name to nothing,
 * and the page never scrolls sideways.
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

const HOUR = 3_600_000;

function sessionTabs(now: number) {
  return [
    {
      name: 'latencies.py',
      language: 'python',
      content: 'print(1.24)',
      lastAnswer: { kind: 'code', status: 'ok', numeral: '1.24', label: 's', durationMs: 412, ranAt: now - 2 * HOUR },
    },
    {
      name: 'SQL',
      language: 'sql',
      content: '',
      kind: 'sql',
      workspaceTabId: 'lingua:workspace:sql',
      lastAnswer: {
        kind: 'sql',
        status: 'ok',
        numeral: '12',
        unit: 'rows',
        subject: 'orders by city',
        context: 'orders-dev · Postgres',
        durationMs: 38,
        ranAt: now - 2 * HOUR,
      },
    },
    {
      name: 'HTTP',
      language: 'http',
      content: '',
      kind: 'http',
      workspaceTabId: 'lingua:workspace:http',
      lastAnswer: { kind: 'http', status: 'ok', numeral: '200', unit: 'status', label: 'OK', subject: 'GET /v1/services', context: 'staging', ranAt: now - 26 * HOUR },
    },
    {
      name: 'squares.js',
      language: 'javascript',
      content: '',
      lastAnswer: { kind: 'code', status: 'ok', numeral: '1 – 64', unit: 'items', total: 8, ranAt: now - 4 * 24 * HOUR },
    },
    {
      name: 'broken.ts',
      language: 'typescript',
      content: '',
      lastAnswer: { kind: 'code', status: 'error', numeral: '', label: 'TypeError', ranAt: now - 5 * 60_000 },
    },
  ];
}

for (const width of [375, 768]) {
  test(`Pick up rows show each name in full at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await seedSession(page, { language: 'en', restoreSessionMode: 'ask' });
    await page.addInitScript(tabs => {
      if (window.localStorage.getItem('lingua-session')) return;
      window.localStorage.setItem('lingua-session', JSON.stringify({ state: { savedTabs: tabs, savedActiveIndex: 0 }, version: 2 }));
    }, sessionTabs(Date.now()));
    await gotoApp(page);

    const rows = page.locator('[data-testid^="start-pick-up-row-"]');
    await expect(rows).toHaveCount(5);
    await page.evaluate(() => document.fonts.ready);

    const names = await page.locator('.start-row-name').evaluateAll(nodes =>
      nodes.map(node => ({ text: node.textContent, scroll: node.scrollWidth, client: node.clientWidth }))
    );
    expect(names.map(name => name.text)).toEqual(['latencies.py', 'orders by city', 'GET /v1/services', 'squares.js', 'broken.ts']);
    for (const name of names) expect(name.scroll, name.text ?? '').toBeLessThanOrEqual(name.client);

    await expect(page.getByTestId('start-pick-up-row-2').locator('.start-row-detail')).toHaveText('orders-dev · Postgres');
    await expect(page.getByTestId('start-pick-up-row-3').locator('.start-row-detail')).toHaveText('staging');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
