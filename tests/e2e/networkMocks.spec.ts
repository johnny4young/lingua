/**
 * Every page of a test gets the network mocks, including one opened by hand.
 * The checks run offline, where only a route can answer, so a missing mock fails
 * here instead of reaching the production workers.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from '@playwright/test';
import { expect, newMockedContext, test } from './licenseWeb.helpers';

const MOCKED_ENDPOINTS = [
  { url: 'https://updates.linguacode.dev/web/version', method: 'GET', status: 200 },
  { url: 'https://updates.linguacode.dev/telemetry', method: 'POST', status: 204 },
  { url: 'https://licenses.linguacode.dev/licenses/status?deviceId=e2e', method: 'GET', status: 200 },
  { url: 'https://licenses.linguacode.dev/licenses/activate', method: 'POST', status: 200 },
  { url: 'https://licenses.linguacode.dev/licenses/devices/remove', method: 'POST', status: 200 },
];

async function expectNewPageIsMocked(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await context.setOffline(true);
  const statuses = await page.evaluate(
    endpoints =>
      Promise.all(
        endpoints.map(({ url, method }) =>
          fetch(url, {
            method,
            ...(method === 'POST'
              ? { headers: { 'Content-Type': 'application/json' }, body: '{}' }
              : {}),
          }).then(
            response => response.status,
            () => 'unreachable'
          )
        )
      ),
    MOCKED_ENDPOINTS
  );
  expect(statuses).toEqual(MOCKED_ENDPOINTS.map(endpoint => endpoint.status));
}

test('a page opened by hand in the test context is mocked', async ({ context }) => {
  await expectNewPageIsMocked(context);
});

test('a page in a separate mocked context is mocked', async ({ browser }) => {
  const context = await newMockedContext(browser);
  try {
    await expectNewPageIsMocked(context);
  } finally {
    await context.close();
  }
});

test('no spec opens a context without the mocks', () => {
  const e2eDir = path.join(process.cwd(), 'tests/e2e');
  const unmocked = readdirSync(e2eDir).filter(
    file =>
      file !== 'licenseWeb.helpers.ts' &&
      file !== 'networkMocks.spec.ts' &&
      file.endsWith('.ts') &&
      readFileSync(path.join(e2eDir, file), 'utf8').includes('browser.newContext(')
  );
  expect(unmocked).toEqual([]);
});
