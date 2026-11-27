import fs from 'node:fs';
import path from 'node:path';
import type { Page, Route } from '@playwright/test';
import { expect, gotoApp, seedSession, test, waitForSeededWorkspaceSettled } from './licenseWeb.helpers';

const screenshotDir = path.resolve(process.cwd(), 'output/playwright/http-pipeline-run');
const BASE = 'https://api.staging.acme.dev';
const NOW = '2026-11-20T10:00:00.000Z';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': '*',
};

const request = (id: string, method: 'GET' | 'POST', url: string, extra: object = {}) => ({
  version: 1,
  id,
  name: id,
  transport: 'http',
  method,
  url,
  headers: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});

const capture = (id: string, path: string, targetVariable: string) => ({ id, source: 'body-json', path, targetVariable, enabled: true });
const assertion = (id: string, path: string, expected: string) => ({
  id,
  source: 'body-json',
  path,
  comparator: 'equals',
  expected,
  enabled: true,
});

/** A four-step pipeline against a staging environment: step 3's check fails, so step 4 is never reached. */
const WORKSPACE = {
  state: {
    requests: [
      request('Create deploy', 'POST', '{{baseUrl}}/v1/deploys', { captures: [capture('c1', 'id', 'deployId')] }),
      request('Deploy state', 'GET', '{{baseUrl}}/v1/deploys/{{deployId}}', {
        captures: [capture('c2', 'service', 'service')],
        assertions: [assertion('a1', 'state', 'rolling')],
      }),
      request('Service health', 'GET', '{{baseUrl}}/v1/services?name={{service}}', {
        assertions: [assertion('a2', 'items[0].status', 'healthy')],
      }),
      request('Notify', 'POST', '{{baseUrl}}/v1/notify?service={{service}}&deploy={{deployId}}'),
    ],
    responsesByRequestId: {},
    activeRequestId: 'Create deploy',
    environments: [
      {
        version: 1,
        id: 'staging',
        name: 'staging',
        variables: [{ id: 'v1', key: 'baseUrl', value: BASE, secret: false }],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    activeEnvironmentId: 'staging',
    collectionVariables: [],
    httpPipelines: [
      {
        version: 1,
        id: 'deploy',
        name: 'deploy, then verify',
        steps: ['Create deploy', 'Deploy state', 'Service health', 'Notify'].map(requestId => ({
          id: `step-${requestId}`,
          requestId,
          enabled: true,
        })),
        stopOnFailure: true,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    activeHttpPipelineId: 'deploy',
  },
  version: 1,
};

const RESPONSES: Record<string, { status: number; body: unknown; delayMs: number }> = {
  'POST /v1/deploys': { status: 201, body: { id: 'dep_81f2' }, delayMs: 120 },
  'GET /v1/deploys/dep_81f2': { status: 200, body: { state: 'rolling', service: 'billing' }, delayMs: 30 },
  'GET /v1/services': { status: 200, body: { items: [{ status: 'degraded' }] }, delayMs: 50 },
};

async function mockStaging(page: Page): Promise<string[]> {
  const sent: string[] = [];
  await page.route(`${BASE}/**`, async (route: Route) => {
    const call = route.request();
    if (call.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(call.url());
    const key = `${call.method()} ${url.pathname}`;
    sent.push(key);
    const reply = RESPONSES[key];
    if (!reply) return route.fulfill({ status: 404, headers: CORS, body: '' });
    await new Promise(resolve => setTimeout(resolve, reply.delayMs));
    return route.fulfill({
      status: reply.status,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify(reply.body),
    });
  });
  return sent;
}

async function capture375To1440(page: Page, name: string): Promise<void> {
  for (const [width, suffix] of [[1440, ''], [768, '-768'], [375, '-375']] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.mouse.move(0, 0);
    await page.evaluate(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    await page.screenshot({ path: path.join(screenshotDir, `${name}${suffix}.png`), animations: 'disabled' });
  }
}

const COPY = {
  en: {
    passed: '2of 4 passed',
    received: 'received',
    notReached: 'not reached — the pipeline stopped at step 3',
    wouldSend: 'would send {{service}} and {{deployId}}',
  },
  es: {
    passed: '2de 4 pasaron',
    received: 'recibido',
    notReached: 'no se alcanzó: el pipeline se detuvo en el paso 3',
    wouldSend: 'enviaría {{service}} y {{deployId}}',
  },
} as const;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  fs.mkdirSync(screenshotDir, { recursive: true });
});

for (const language of ['en', 'es'] as const) {
  test(`runs a four-step pipeline against the active environment and stops at the failed check (${language})`, async ({
    page,
  }) => {
    const copy = COPY[language];
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedSession(page, {
      language,
      restoreSessionMode: 'never',
      appearance: { theme: 'dark', editorTheme: 'lingua-ink' },
    });
    await page.addInitScript(seed => {
      if (!window.localStorage.getItem('lingua-workspace-tool-state'))
        window.localStorage.setItem('lingua-workspace-tool-state', JSON.stringify(seed));
    }, WORKSPACE);
    const sent = await mockStaging(page);
    await gotoApp(page);
    await waitForSeededWorkspaceSettled(page);
    await page.keyboard.press('ControlOrMeta+Shift+K');
    await page.getByTestId('http-pipeline-open').click();

    const manager = page.getByTestId('http-pipeline-manager');
    await expect(manager.getByTestId('http-pipeline-environment')).toHaveText('staging · api.staging.acme.dev');
    const stopOnFailure = manager.getByTestId('http-pipeline-stop-on-failure');
    await expect(stopOnFailure).toHaveAttribute('aria-checked', 'true');

    const run = manager.getByTestId('http-pipeline-run');
    await expect(run).toBeEnabled();
    await run.click();
    await expect(manager.getByTestId('http-pipeline-passed')).toHaveAttribute('data-phase', 'failed');
    await expect(manager.getByTestId('http-pipeline-passed')).toHaveText(copy.passed);
    expect(sent).toEqual(['POST /v1/deploys', 'GET /v1/deploys/dep_81f2', 'GET /v1/services']);

    const steps = manager.getByTestId('http-pipeline-step');
    await expect(steps).toHaveCount(4);
    await expect(steps.nth(0)).toHaveAttribute('data-status', 'passed');
    await expect(steps.nth(0).getByTestId('http-pipeline-step-numeral')).toHaveText('201created');
    await expect(steps.nth(0).getByTestId('http-pipeline-step-capture')).toContainText('"dep_81f2"');
    await expect(steps.nth(1)).toHaveAttribute('data-status', 'passed');
    await expect(steps.nth(2)).toHaveAttribute('data-status', 'failed');
    await expect(steps.nth(2).getByTestId('http-pipeline-step-check')).toHaveText(
      `body.items[0].status == "healthy"${copy.received}"degraded"`
    );
    const notReached = steps.nth(3);
    await expect(notReached).toHaveAttribute('data-status', 'skipped');
    await expect(notReached).toHaveAttribute('data-dim', '');
    await expect(notReached).toContainText(copy.notReached);
    await expect(notReached.getByText(copy.wouldSend)).toBeVisible();

    await capture375To1440(page, `http-pipeline-run-${language}`);
  });
}
