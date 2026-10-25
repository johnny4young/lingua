/**
 * Controlled connectivity signal, not a physical network outage. The pending
 * synthetic backend reply stays held across navigator.onLine changes so the
 * replay overlap is deterministic. No service or database is contacted.
 */
import {
  test,
  expect,
  gotoApp,
  seedSession,
  waitForSeededWorkspaceSettled,
} from './licenseWeb.helpers';

for (const language of ['en', 'es'] as const) {
  for (const method of ['GET', 'POST'] as const) {
    for (const timing of ['during', 'after'] as const) {
      test(`${language} ${method} queued ${timing} earlier replay`, async ({ page }, info) => {
        const calls: Array<{ id: string; method: string }> = [];
        const backendErrors: string[] = [];
        let release!: () => void;
        const held = new Promise<void>(resolve => {
          release = resolve;
        });
        let cleanup = false;
        await seedSession(page, { language, showStatusBar: true });
        await page.addInitScript(
          ({ language, method }) => {
            let online = true;
            Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
            (window as unknown as { __qaOnline: (value: boolean) => void }).__qaOnline = value => {
              online = value;
              window.dispatchEvent(new Event(value ? 'online' : 'offline'));
            };
            localStorage.setItem(
              'lingua-settings',
              JSON.stringify({
                version: 3,
                state: {
                  language,
                  lastSeenVersion: '1.6.2',
                  suppressTourAutoStart: true,
                  hasCompletedOnboardingFirstRun: true,
                  hasCompletedOnboardingFirstSnippet: true,
                  telemetryConsent: 'declined',
                  showStatusBar: true,
                },
              })
            );
            localStorage.setItem(
              'lingua-snippets',
              JSON.stringify({ version: 0, state: { snippets: [] } })
            );
            const make = (id: string, name: string, verb: string) => ({
              version: 1,
              id,
              name,
              method: verb,
              transport: 'http',
              headers: [],
              url: `https://qa.example.invalid/${id}`,
              createdAt: '2026-10-25T00:00:00.000Z',
              updatedAt: '2026-10-25T00:00:00.000Z',
            });
            localStorage.setItem(
              'lingua-workspace-tool-state',
              JSON.stringify({
                version: 1,
                state: {
                  requests: [
                    make('qa-first', 'First synthetic read', 'GET'),
                    make('qa-second', 'Second synthetic request', method),
                  ],
                  activeRequestId: 'qa-first',
                  responsesByRequestId: {},
                  environments: [],
                  activeEnvironmentId: null,
                  collectionVariables: [],
                  httpPipelines: [],
                  activeHttpPipelineId: null,
                },
              })
            );
          },
          { language, method }
        );
        await page.route('https://qa.example.invalid/**', async route => {
          const request = route.request();
          const headers = {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-allow-headers': '*',
          };
          if (request.method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers });
            return;
          }
          const id = new URL(request.url()).pathname.slice(1);
          calls.push({ id, method: request.method() });
          if (id === 'qa-first') await held;
          try {
            await route.fulfill({
              status: 200,
              headers,
              contentType: 'application/json',
              body: JSON.stringify({ synthetic: id }),
            });
          } catch (error) {
            if (!cleanup) backendErrors.push(String(error));
          }
        });
        const online = async (value: boolean) => {
          await page.evaluate(
            value =>
              (window as unknown as { __qaOnline: (value: boolean) => void }).__qaOnline(value),
            value
          );
          await expect(page.getByTestId('status-bar-offline')).toHaveCount(value ? 0 : 1);
        };
        const select = async (id: string) => {
          await page
            .locator(`[data-testid="http-request-list-row"][data-request-id="${id}"]`)
            .click();
          await expect(page.getByTestId('http-request-editor-url')).toHaveValue(
            `https://qa.example.invalid/${id}`
          );
        };
        const finishFirst = async () => {
          release();
          await select('qa-first');
          await expect(page.getByTestId('http-request-editor-stop')).toHaveCount(0);
          await expect
            .poll(() =>
              page.evaluate(() => {
                const state = JSON.parse(
                  localStorage.getItem('lingua-workspace-tool-state') ?? '{}'
                ).state;
                return state?.responsesByRequestId?.['qa-first']?.length ?? 0;
              })
            )
            .toBe(1);
        };
        try {
          await gotoApp(page);
          await waitForSeededWorkspaceSettled(page);
          await page.keyboard.press('ControlOrMeta+Shift+K');
          await expect(page.getByTestId('http-workspace-panel')).toBeVisible();
          await select('qa-first');
          await online(false);
          await page.getByTestId('http-request-editor-send').click();
          await expect(page.getByTestId('http-request-editor-queued')).toBeVisible();
          expect(calls).toEqual([]);
          await online(true);
          await expect.poll(() => calls.filter(row => row.id === 'qa-first').length).toBe(1);
          await expect(page.getByTestId('http-request-editor-stop')).toBeVisible();
          if (timing === 'after') await finishFirst();
          await online(false);
          await select('qa-second');
          await page.getByTestId('http-request-editor-send').click();
          await expect(page.getByTestId('http-request-editor-queued')).toBeVisible();
          expect(calls.filter(row => row.id === 'qa-second')).toEqual([]);
          await online(true);
          if (timing === 'during') await finishFirst();
          await select('qa-second');
          if (method === 'GET') {
            await expect
              .poll(() => calls.filter(row => row.id === 'qa-second').length, { timeout: 2500 })
              .toBe(1);
            await expect(page.getByTestId('http-request-editor-queued')).toHaveCount(0);
          } else {
            await expect(page.getByTestId('http-request-editor-send')).toHaveAttribute(
              'data-queue',
              'ready',
              { timeout: 2500 }
            );
            expect(calls.filter(row => row.id === 'qa-second')).toEqual([]);
            await page.getByTestId('http-request-editor-send').click();
            await expect.poll(() => calls.filter(row => row.id === 'qa-second').length).toBe(1);
          }
          await expect(page.getByTestId('http-request-editor-stop')).toHaveCount(0);
          await expect
            .poll(() =>
              page.evaluate(() => {
                const state = JSON.parse(
                  localStorage.getItem('lingua-workspace-tool-state') ?? '{}'
                ).state;
                return state?.responsesByRequestId?.['qa-second']?.length ?? 0;
              })
            )
            .toBe(1);
          expect(backendErrors).toEqual([]);
        } finally {
          cleanup = true;
          release();
          const actual = {
            language,
            method,
            timing,
            calls,
            backendErrors,
            online: await page.evaluate(() => navigator.onLine).catch(() => null),
            queuedChip:
              (await page.getByTestId('http-request-editor-queued').count()) > 0
                ? await page
                    .getByTestId('http-request-editor-queued')
                    .textContent({ timeout: 500 })
                    .catch(() => null)
                : null,
            sendState:
              (await page.getByTestId('http-request-editor-send').count()) > 0
                ? await page
                    .getByTestId('http-request-editor-send')
                    .getAttribute('data-queue', { timeout: 500 })
                    .catch(() => null)
                : null,
          };
          await info.attach('synthetic-outcome', {
            body: JSON.stringify(actual, null, 2),
            contentType: 'application/json',
          });
          const screenshot = info.outputPath('owned-app.png');
          await page
            .screenshot({ path: screenshot, timeout: 2000 })
            .then(() => info.attach('owned-app', { path: screenshot, contentType: 'image/png' }))
            .catch(() => undefined);
        }
      });
    }
  }
}
