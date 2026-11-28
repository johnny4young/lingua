/**
 * Record run on a Python tab: the trace draws while the run records, with a
 * dashed projection past its last step, then names each loop pass and the line
 * that slept; the rail ticks the lines the run reached and the Timeline replays it.
 */
import type { Page } from '@playwright/test';
import { dismissWhatsNew, expect, gotoApp, openConsole, seedSession, test, waitForRunCompleted } from './licenseWeb.helpers';

const CODE = [
  'from statistics import mean',
  'from time import sleep',
  '',
  'latencies = {"api": [38, 41], "worker": [12, 14], "db": [92, 88]}',
  '',
  'for name in latencies:',
  '    sleep(0.6)',
  '    print(name, mean(latencies[name]))',
  '',
  'print("done")',
].join('\n');

async function record(page: Page): Promise<void> {
  await page.getByTestId('action-pill-run-menu').click();
  await page.getByTestId('action-pill-record').click();
}

for (const language of ['en', 'es'] as const) {
  test(`records latencies.py twice and draws its trace while it runs (${language})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await seedSession(page, {
      language,
      primeProLicense: true,
      restoreSessionMode: 'always',
      workflowModeDefaultsByLanguage: { python: 'run' },
      savedTabs: [{ name: 'latencies.py', language: 'python', content: CODE }],
    });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await expect(page.getByRole('button', { name: /latencies\.py/ }).first()).toBeVisible({ timeout: 30_000 });
    await openConsole(page);

    for (let pass = 0; pass < 2; pass += 1) {
      await record(page);
      // Mid-run: the trace is live, dashed past its last step, and the rail beats on the line that sleeps.
      const trace = page.getByTestId('run-trace');
      await expect(trace).toHaveAttribute('data-live', 'true', { timeout: 60_000 });
      await expect(page.getByTestId('run-trace-projection')).toBeAttached();
      await expect(page.locator('.monaco-editor .lingua-rail--running')).toHaveCount(1);
      await waitForRunCompleted(page);
      // Record run opens the Timeline when it settles; the trace sits beside the Console tape.
      await openConsole(page);

      await expect(trace).not.toHaveAttribute('data-live', 'true');
      await expect(trace).toContainText(language === 'en' ? 'Where the run has been' : 'Por dónde pasó la ejecución');
      await expect(page.getByTestId('run-trace-projection')).toHaveCount(0);
      await expect(page.getByTestId('run-trace-loop')).toHaveCount(3);
      await expect(page.getByTestId('run-trace-slowest')).toContainText(/^L7 sleep\(0\.6\) · 1\.\d+ s · \d+%$/u);
      await expect(page.locator('.monaco-editor .lingua-rail--answered')).not.toHaveCount(0);
    }

    await page.getByTestId('run-trace-chart').click({ position: { x: 40, y: 60 } });
    await expect(page.getByTestId('timeline-panel')).toBeVisible();
    await expect(page.getByTestId('timeline-current')).toContainText(language === 'en' ? 'current step 1 ·' : 'paso actual 1 ·');
  });
}
