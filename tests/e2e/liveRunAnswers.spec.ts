/**
 * While a run goes, the answer column says where it is: the loop header names
 * its pass and variable, the line holding the run reads RUNNING with its time,
 * a print inside the loop counts its passes, the run meter names the line and
 * the console waits on it. All of it goes when the run settles.
 */

import type { Page } from '@playwright/test';
import { clickRun, dismissWhatsNew, expect, gotoApp, openConsole, seedSession, test } from './licenseWeb.helpers';

const CODE = [
  'from time import sleep',
  '',
  'latencies = {"api": [38, 41], "worker": [12, 14], "db": [92, 88]}',
  '',
  'for name in latencies:',
  '    sleep(1.2)',
  '    print(name)',
  '',
  'print("done")',
].join('\n');

const COPY = {
  en: { pass: '2 of 3', printed: '1 of 3 printed', running: 'running', line: 'line 6', waiting: 'waiting on sleep(1.2)', last: 'last of 3' },
  es: { pass: '2 de 3', printed: '1 de 3 impresas', running: 'ejecutando', line: 'línea 6', waiting: 'esperando sleep(1.2)', last: 'la última de 3' },
} as const;

async function openLoop(page: Page, language: 'en' | 'es') {
  await seedSession(page, {
    language,
    restoreSessionMode: 'always',
    workflowModeDefaultsByLanguage: { python: 'run' },
    savedTabs: [{ name: 'latencies.py', language: 'python', content: CODE }],
  });
  await gotoApp(page);
  await dismissWhatsNew(page);
  await expect(page.getByRole('button', { name: /latencies\.py/ }).first()).toBeVisible({ timeout: 30_000 });
  await openConsole(page);
}

const liveAnswer = (page: Page, line: number) => page.locator(`[data-testid="lingua-live-answer"][data-line="${line}"]`);

for (const language of ['en', 'es'] as const) {
  test(`a Python run answers on its loop and running line while it goes (${language})`, async ({ page }) => {
    test.setTimeout(120_000);
    const copy = COPY[language];
    await openLoop(page, language);
    await clickRun(page);

    // The second pass: the loop names it, the sleep holds the run, the first print counts one pass.
    await expect(liveAnswer(page, 5)).toContainText(copy.pass, { timeout: 60_000 });
    await expect(liveAnswer(page, 5)).toContainText("name =");
    await expect(liveAnswer(page, 5)).toContainText("'worker'");
    await expect(liveAnswer(page, 6)).toContainText(copy.running);
    await expect(liveAnswer(page, 6).locator('[data-live-kind="running"]')).toBeVisible();
    await expect(page.locator('[data-testid="lingua-inline-result"][data-line="7"]')).toContainText(copy.printed);
    await expect(page.getByTestId('run-meter-line')).toContainText(copy.line);
    const waiting = page.getByTestId('console-waiting-row');
    await expect(waiting).toHaveAttribute('data-line', '6');
    await expect(waiting).toHaveAttribute('data-live', 'true');
    await expect(waiting).toContainText(copy.waiting);
    await expect(page.locator('.lingua-rail--running')).toHaveCount(1);

    await expect(page.getByTestId('action-pill-run')).toHaveAttribute('data-running', 'false', { timeout: 30_000 });
    await expect(page.getByTestId('lingua-live-answer')).toHaveCount(0);
    await expect(page.getByTestId('run-meter-line')).toHaveCount(0);
    await expect(page.locator('[data-testid="lingua-inline-result"][data-line="7"]')).toContainText(copy.last);
  });
}
