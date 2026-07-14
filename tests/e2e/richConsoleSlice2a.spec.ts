/**
 * RL-044 Slice 2a visual smoke matrix.
 *
 * These tests use the test-only console seeding hook to validate the
 * renderer surface that workers do not emit until Slice 2b. Each case
 * captures a named screenshot under output/playwright/rich-console-slice2a.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { ConsoleEntry } from '../../src/renderer/types';
import { expect, seedSession, test } from './licenseWeb.helpers';
import {
  RICH_CONSOLE_SCREENSHOT_CASES,
  writeRichConsoleScreenshotGallery,
} from './richConsoleSlice2aGallery';

type ConsoleEntrySeed = Omit<ConsoleEntry, 'id' | 'timestamp'>;

declare global {
  interface Window {
    __linguaE2e?: {
      clearConsole: () => void;
      addConsoleEntries: (entries: ConsoleEntrySeed[]) => void;
    };
  }
}

const screenshotDir = path.resolve(process.cwd(), 'output/playwright/rich-console-slice2a');
const screenshotFileName = (title: string) => {
  const match = RICH_CONSOLE_SCREENSHOT_CASES.find(item => item.title === title);
  if (!match) throw new Error(`Missing screenshot matrix case: ${title}`);
  return match.fileName;
};

const sampleImageSrc = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="180" viewBox="0 0 520 180">
    <rect width="520" height="180" rx="18" fill="#062a2a"/>
    <circle cx="82" cy="90" r="48" fill="#4cc9a4"/>
    <path d="M170 65h265M170 92h210M170 119h165" stroke="#e6fff7" stroke-width="16" stroke-linecap="round"/>
    <text x="170" y="154" fill="#9ae6d1" font-family="monospace" font-size="24">Lingua image payload</text>
  </svg>`
).toString('base64')}`;

const sampleChartSpec = {
  $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
  width: 360,
  height: 180,
  mark: { type: 'bar', cornerRadiusTopLeft: 4, cornerRadiusTopRight: 4 },
  data: {
    values: [
      { label: 'Alpha', value: 8 },
      { label: 'Beta', value: 13 },
      { label: 'Gamma', value: 5 },
    ],
  },
  encoding: {
    x: { field: 'label', type: 'nominal', axis: { labelAngle: 0 } },
    y: { field: 'value', type: 'quantitative' },
    color: { field: 'label', type: 'nominal', legend: null },
  },
};

test.describe.configure({ mode: 'serial' });

test.describe('rich console Slice 2a visual matrix', () => {
  test.beforeAll(() => {
    fs.rmSync(screenshotDir, { recursive: true, force: true });
    fs.mkdirSync(screenshotDir, { recursive: true });
  });

  test.afterAll(() => {
    writeRichConsoleScreenshotGallery(screenshotDir);
  });

  async function prepareRichConsole(page: Page, entries: ConsoleEntrySeed[]) {
    await seedSession(page, { language: 'en' });
    await page.goto('/?e2e=rich-console-slice2a');
    await expect(page.getByTestId('rich-console-e2e-fixture')).toBeVisible();

    await expect.poll(() => page.evaluate(() => Boolean(window.__linguaE2e))).toBe(true);

    await page.evaluate(seededEntries => {
      const hooks = window.__linguaE2e;
      if (!hooks) throw new Error('Missing Lingua E2E hooks');
      hooks.clearConsole();
      hooks.addConsoleEntries(seededEntries);
    }, entries);
  }

  async function captureLocator(testInfo: TestInfo, fileName: string, locator: Locator) {
    const filePath = path.join(screenshotDir, fileName);
    await locator.screenshot({ path: filePath });
    await testInfo.attach(fileName, { path: filePath, contentType: 'image/png' });
  }

  async function capturePage(testInfo: TestInfo, fileName: string, page: Page) {
    const filePath = path.join(screenshotDir, fileName);
    await page.screenshot({ path: filePath, fullPage: false });
    await testInfo.attach(fileName, { path: filePath, contentType: 'image/png' });
  }

  test('html payload renders inline and in the details popover', async ({ page }, testInfo) => {
    await prepareRichConsole(page, [
      {
        type: 'log',
        content: 'HTML payload',
        language: 'javascript',
        payload: [
          {
            kind: 'html',
            height: 160,
            html: `<!doctype html>
              <html>
                <body style="margin:0;background:#061a1a;color:#e9fff8;font:16px ui-monospace,monospace;">
                  <section style="height:160px;display:grid;place-items:center;border:3px solid #4cc9a4;border-radius:16px;">
                    <strong>Sandbox HTML OK</strong>
                  </section>
                </body>
              </html>`,
          },
        ],
      },
    ]);

    const iframe = page.getByTestId('console-rich-html-iframe');
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(
      page.frameLocator('[data-testid="console-rich-html-iframe"]').getByText('Sandbox HTML OK')
    ).toBeVisible();
    await captureLocator(
      testInfo,
      screenshotFileName('HTML inline'),
      page.getByTestId('console-rich-html')
    );

    await page.getByTestId('console-rich-open-details').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('console-rich-html-iframe')).toBeVisible();
    await captureLocator(testInfo, screenshotFileName('HTML details popover'), dialog);
  });

  test('image payload renders inline and in the details popover', async ({ page }, testInfo) => {
    await prepareRichConsole(page, [
      {
        type: 'log',
        content: 'Image payload',
        language: 'javascript',
        payload: [
          {
            kind: 'image',
            src: sampleImageSrc,
            mime: 'image/svg+xml',
          },
        ],
      },
    ]);

    await expect(page.getByTestId('console-rich-image')).toBeVisible();
    await captureLocator(
      testInfo,
      screenshotFileName('Image inline'),
      page.getByTestId('console-rich-image-wrapper')
    );

    await page.getByTestId('console-rich-open-details').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('console-rich-image')).toBeVisible();
    await captureLocator(testInfo, screenshotFileName('Image details popover'), dialog);
  });

  test('error payload renders clickable stack frames, popover, and context menu', async ({
    page,
  }, testInfo) => {
    await prepareRichConsole(page, [
      {
        type: 'error',
        content: 'TypeError: Cannot read properties of undefined',
        language: 'typescript',
        payload: [
          {
            kind: 'error',
            message: 'Cannot read properties of undefined',
            stack: [
              {
                text: 'at runExample (src/example.ts:12:5)',
                file: 'src/example.ts',
                line: 12,
                column: 5,
                fnName: 'runExample',
              },
              {
                text: 'at <anonymous>',
              },
            ],
          },
        ],
      },
    ]);

    await expect(page.getByTestId('console-rich-error')).toBeVisible();
    await captureLocator(
      testInfo,
      screenshotFileName('Error inline'),
      page.getByTestId('console-rich-error')
    );

    const frame = page.getByTestId('console-rich-error-frame-clickable');
    await frame.click();
    await expect(page.getByText('Opening src/example.ts:12 is not available yet.')).toBeVisible();

    await page.getByTestId('console-rich-open-details').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByTestId('console-rich-error-frame-clickable')).toBeVisible();
    await captureLocator(testInfo, screenshotFileName('Error details popover'), dialog);

    await dialog.getByTestId('console-rich-error-frame-clickable').click({
      button: 'right',
    });
    await expect(page.getByTestId('console-rich-error-frame-menu')).toBeVisible();
    await capturePage(testInfo, screenshotFileName('Error frame context menu'), page);
  });

  test('invalid media payloads render visible security fallbacks', async ({ page }, testInfo) => {
    await prepareRichConsole(page, [
      {
        type: 'warn',
        content: 'Rejected media payloads',
        language: 'javascript',
        payload: [
          {
            kind: 'image',
            src: 'javascript:alert(1)',
            mime: 'image/png',
          },
          {
            kind: 'html',
            html: '',
            height: 120,
          },
        ],
      },
    ]);

    await expect(page.getByTestId('console-rich-image-rejected')).toBeVisible();
    await expect(page.getByTestId('console-rich-html-rejected')).toBeVisible();
    await captureLocator(
      testInfo,
      screenshotFileName('Invalid media fallbacks'),
      page.getByTestId('console-entry-row')
    );
  });

  test('chart payload renders inline, in the popover, and exposes the gated export menu', async ({
    page,
  }, testInfo) => {
    await prepareRichConsole(page, [
      {
        type: 'log',
        content: '[chart]',
        language: 'javascript',
        payload: [
          {
            kind: 'chart',
            spec: sampleChartSpec,
          },
        ],
      },
    ]);

    const inlineChart = page.getByTestId('console-rich-chart').first();
    await expect(inlineChart).toHaveAttribute('data-chart-status', 'ready');
    await expect(inlineChart.locator('canvas')).toBeVisible();
    await captureLocator(testInfo, screenshotFileName('Chart inline'), inlineChart);

    await page.getByTestId('console-rich-open-details').click();
    const dialog = page.getByRole('dialog');
    const dialogChart = dialog.getByTestId('console-rich-chart');
    await expect(dialogChart).toHaveAttribute('data-chart-status', 'ready');
    await expect(dialogChart.locator('canvas')).toBeVisible();
    await dialog.getByTestId('console-rich-chart-actions').click();
    await expect(dialog.getByTestId('console-rich-chart-export-pro')).toBeVisible();
    await captureLocator(testInfo, screenshotFileName('Chart details popover and menu'), dialog);
  });
});
