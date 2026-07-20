/**
 * implementation detail implementation — console list windower (web e2e).
 *
 * Validates in real Chromium what jsdom cannot: that a flooded 500-row
 * console mounts only a viewport-sized slice of rows, that sticky
 * auto-scroll still pins the latest line, and that a chart scrolled out of
 * the window unmounts (releasing its Vega canvas) and remounts on
 * scroll-back. The pure offset math is unit-tested in
 * `tests/hooks/useListWindow.test.ts`.
 *
 * Uses the test-only console seeding hook (`window.__linguaE2e`) on the
 * rich-console fixture route, which mounts `<ConsolePanel>` in a bounded
 * `h-screen` container so the windower engages.
 */

import type { ConsoleEntry } from '../../src/renderer/types';
import { expect, seedSession, test } from './licenseWeb.helpers';

type ConsoleEntrySeed = Omit<ConsoleEntry, 'id' | 'timestamp'>;

declare global {
  interface Window {
    __linguaE2e?: {
      clearConsole: () => void;
      addConsoleEntries: (entries: ConsoleEntrySeed[]) => void;
    };
  }
}

const chartSpec = {
  $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
  width: 320,
  height: 180,
  mark: 'bar',
  data: {
    values: [
      { label: 'A', value: 8 },
      { label: 'B', value: 13 },
      { label: 'C', value: 5 },
    ],
  },
  encoding: {
    x: { field: 'label', type: 'nominal' },
    y: { field: 'value', type: 'quantitative' },
  },
};

async function seedConsole(
  page: import('@playwright/test').Page,
  entries: ConsoleEntrySeed[]
): Promise<void> {
  await seedSession(page, { language: 'en' });
  await page.goto('/?e2e=rich-console-gallery');
  await expect(page.getByTestId('rich-console-e2e-fixture')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.__linguaE2e))).toBe(true);
  await page.evaluate((seeded) => {
    const hooks = window.__linguaE2e;
    if (!hooks) throw new Error('Missing Lingua E2E hooks');
    hooks.clearConsole();
    hooks.addConsoleEntries(seeded);
  }, entries);
}

test.describe('console windowing (implementation detail implementation)', () => {
  test('mounts only a viewport-sized slice for a 500-row session and pins to bottom', async ({
    page,
  }) => {
    const entries: ConsoleEntrySeed[] = Array.from({ length: 500 }, (_, i) => ({
      type: 'log',
      content: `line ${i}`,
      language: 'javascript',
    }));
    await seedConsole(page, entries);

    // Sticky auto-scroll keeps the latest line pinned in view…
    await expect(page.getByText('line 499', { exact: true })).toBeVisible();

    // …while only a small windowed slice of the 500 rows is actually mounted.
    await expect
      .poll(() => page.getByTestId('console-entry-row').count())
      .toBeLessThan(120);

    // A row far above the viewport is not in the DOM at all (unmounted, not
    // merely hidden) — the proof that off-window rows release their subtree.
    await expect(page.getByText('line 0', { exact: true })).toHaveCount(0);

    // The window range is bottom-anchored.
    const range = await page
      .locator('[data-window-range]')
      .getAttribute('data-window-range');
    expect(range).toMatch(/^\d+:499$/);
  });

  test('releases an off-window chart canvas and remounts it on scroll-back', async ({
    page,
  }) => {
    const entries: ConsoleEntrySeed[] = [
      {
        type: 'log',
        content: '[chart]',
        language: 'javascript',
        payload: [{ kind: 'chart', spec: chartSpec }],
      },
      ...Array.from({ length: 400 }, (_, i) => ({
        type: 'log' as const,
        content: `row ${i}`,
        language: 'javascript',
      })),
    ];
    await seedConsole(page, entries);

    // Pinned to the bottom, the chart at row 0 is off-window and unmounted —
    // RichValueChart.finalize() has released its Vega view.
    await expect(page.getByTestId('console-rich-chart')).toHaveCount(0);

    // Scroll the container to the top so the chart row re-enters the window.
    await page.locator('[data-window-range]').evaluate((el) => {
      el.scrollTop = 0;
    });

    // The chart remounts and renders again.
    await expect(page.getByTestId('console-rich-chart').first()).toBeVisible();
  });
});
