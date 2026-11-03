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

// These never mount App, so nothing in them reaches the mocked hosts.
const UNMOCKED_TEST_ALLOWLIST = [
  'localMcpVisual.spec.ts',
  'projectTerminalVisual.spec.ts',
  'projectTestsVisual.spec.ts',
  'shellCsp.spec.ts',
];

function e2eSources(): { file: string; source: string }[] {
  const e2eDir = path.join(process.cwd(), 'tests/e2e');
  return readdirSync(e2eDir, { recursive: true, encoding: 'utf8' })
    .filter(file => file.endsWith('.ts'))
    .sort()
    .map(file => ({ file, source: readFileSync(path.join(e2eDir, file), 'utf8') }));
}

function importsTestAsValue(source: string): boolean {
  const imports = source.matchAll(/import\s+\{([^}]*)\}\s+from\s+['"]@playwright\/test['"]/g);
  return [...imports].some(([, names]) => names.split(',').some(name => /^test\b/.test(name.trim())));
}

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
  const unmocked = e2eSources()
    .filter(
      ({ file, source }) =>
        file !== 'licenseWeb.helpers.ts' &&
        file !== 'networkMocks.spec.ts' &&
        source.includes('browser.newContext(')
    )
    .map(({ file }) => file);
  expect(unmocked).toEqual([]);
});

test('no spec skips the mocked test fixture', () => {
  const direct = e2eSources()
    .filter(({ file, source }) => file !== 'licenseWeb.helpers.ts' && importsTestAsValue(source))
    .map(({ file }) => file);
  expect(direct).toEqual(UNMOCKED_TEST_ALLOWLIST);
});
