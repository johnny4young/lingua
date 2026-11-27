/**
 * Start in the Ink and Paper packs: the restore prompt waits while Pick up
 * offers the same restore, the prompt's placeholder reads in the code face at
 * 4.5:1, an answer to an earlier line reads stale, and Paper lays its cards
 * lighter than the page.
 */

import type { Page } from '@playwright/test';
import { contrastRatio } from '../__fixtures__/colorContrast';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

// The packs ship with Recursive, whose MONO axis is what makes it a code face.
const RECURSIVE = "'Recursive', 'JetBrains Mono', ui-monospace, monospace";
const PACKS = {
  ink: { theme: 'dark', editorTheme: 'lingua-ink', fontFamily: RECURSIVE },
  paper: { theme: 'light', editorTheme: 'lingua-paper', fontFamily: RECURSIVE },
} as const;

const SESSION = [
  {
    name: 'latencies.py',
    language: 'python',
    content: 'print(1.24)',
    lastAnswer: { kind: 'code', status: 'ok', numeral: '1.24', label: 's', durationMs: 412, ranAt: Date.now() - 3_600_000 },
  },
];

async function openStart(page: Page, palette: keyof typeof PACKS, language: 'en' | 'es' = 'en') {
  await seedSession(page, { language, restoreSessionMode: 'ask', appearance: PACKS[palette], savedTabs: SESSION });
  await gotoApp(page);
  await expect(page.locator('html')).toHaveAttribute('data-palette', palette);
  await expect(page.getByTestId('start-pick-up')).toBeVisible();
}

/** Contrast of the element's text against the first opaque background behind it; a canvas resolves any CSS colour. */
async function textContrast(page: Page, selector: string): Promise<number> {
  const [fg, bg] = await page.locator(selector).first().evaluate(node => {
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const channels = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = Array.from(context.getImageData(0, 0, 1, 1).data).map(value => value / 255);
      return { r: r!, g: g!, b: b!, a: a! };
    };
    let ground: Element | null = node;
    let background = channels('transparent');
    while (ground && background.a < 1) {
      background = channels(getComputedStyle(ground).backgroundColor);
      ground = ground.parentElement;
    }
    return [channels(getComputedStyle(node).color), background];
  });
  return contrastRatio(fg, bg);
}

for (const palette of ['ink', 'paper'] as const) {
  test(`${palette}: the prompt placeholder and a stale answer read at 4.5:1 in the code face`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStart(page, palette);

    const placeholder = page.locator('.start-prompt .editorPlaceholder');
    await expect(placeholder).toBeVisible();
    expect(await textContrast(page, '.start-prompt .editorPlaceholder')).toBeGreaterThanOrEqual(4.5);
    const face = (selector: string) =>
      page.locator(selector).first().evaluate(node => {
        const style = getComputedStyle(node);
        return `${style.fontFamily.split(',')[0]} | ${style.fontVariationSettings}`;
      });
    const placeholderFace = await face('.start-prompt .editorPlaceholder');
    expect(placeholderFace).toBe('Recursive | "MONO" 1');

    await page.getByTestId('start-prompt').click();
    await page.keyboard.insertText('[1, 2, 3].map(n => n * n)');
    expect(await face('.start-prompt .view-lines')).toBe(placeholderFace);

    const answer = page.getByTestId('start-prompt-answer');
    await expect(answer).toContainText('1 – 9', { timeout: 15_000 });
    await expect(answer).not.toHaveAttribute('data-stale');

    await page.keyboard.press('Backspace');
    await expect(answer).toHaveAttribute('data-stale', '');
    await expect(answer).toHaveAttribute('aria-live', 'off');
    expect(await textContrast(page, '.start-prompt-value')).toBeGreaterThanOrEqual(4.5);

    await page.keyboard.insertText(')');
    await expect(answer).not.toHaveAttribute('data-stale', { timeout: 15_000 });
  });
}

test('paper: the prompt card and language tiles sit lighter than the page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStart(page, 'paper');
  const background = (selector: string) => page.locator(selector).first().evaluate(node => getComputedStyle(node).backgroundColor);
  const pageGround = await background('[data-testid="start-page"]');
  expect(await background('[data-testid="start-prompt"]')).toBe('rgb(255, 255, 255)');
  expect(await background('[data-testid="start-new-javascript"]')).toBe('rgb(255, 255, 255)');
  expect(await background('[data-testid="start-workspace-sql"]')).toBe('rgba(0, 0, 0, 0)');
  expect(pageGround).not.toBe('rgb(255, 255, 255)');
});

for (const language of ['en', 'es'] as const) {
  test(`${language}: the restore prompt waits while Pick up offers the session`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStart(page, 'paper', language);
    await expect(page.getByTestId('start-reopen-all')).toBeVisible();
    await expect(page.getByTestId('status-notice-banner')).toHaveCount(0);

    await page.getByTestId('start-new-javascript').click();
    await expect(page.getByTestId('status-notice-banner')).toContainText(language === 'en' ? 'Restore 1 tab' : 'Restaurar 1 pestaña');
  });
}
