import type { Locator, Page } from '@playwright/test';
import { createJavaScriptTab, expect, gotoApp, openConsole, seedSession, selectWorkflowMode, test } from './licenseWeb.helpers';
import { isKnownBenignConsoleError } from './consoleErrorFilter';
import { contrastRatio, over, type Rgba } from '../__fixtures__/colorContrast';

test.describe.configure({ mode: 'parallel' });

const PACKS = {
  ink: { theme: 'dark', editorTheme: 'lingua-ink' },
  paper: { theme: 'light', editorTheme: 'lingua-paper' },
} as const;

const SOURCE = [
  'function quickSort(arr) {',
  '  if (arr.length <= 1) return arr;',
  '  const pivot = arr[Math.floor(arr.length / 2)];',
  '  const left = arr.filter((x) => x < pivot);',
  '  const mid = arr.filter((x) => x === pivot);',
  '  const right = arr.filter((x) => x > pivot);',
  '  return [...quickSort(left), ...mid, ...quickSort(right)];',
  '}',
  '',
  'const nums = [3, 6, 8, 10, 1, 2, 1];',
  'console.log(quickSort(nums));',
].join('\n');

async function moveToLine(page: Page, line: number) {
  await page.locator('.monaco-editor').click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await page.keyboard.press('Home');
  for (let index = 1; index < line; index += 1) await page.keyboard.press('ArrowDown');
}

/** Pauses on line 4 for the second time, with a watch whose value and one whose error change the rows. */
async function pauseInRecursion(page: Page, palette: keyof typeof PACKS) {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' && !isKnownBenignConsoleError(message.text())) errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedSession(page, { language: 'en', appearance: PACKS[palette] });
  await gotoApp(page);
  await createJavaScriptTab(page);
  // Pasted, not typed, so auto-indent and auto-closing leave the block as written.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('.monaco-editor').click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.evaluate(text => navigator.clipboard.writeText(text), SOURCE);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  await moveToLine(page, 4);
  await page.keyboard.press('Control+Shift+B');
  await moveToLine(page, 11);
  await page.keyboard.press('Control+Shift+B');
  await openConsole(page);
  await page.getByTestId('bottom-panel-debugger-tab').click();
  await page.getByTestId('debugger-breakpoint-edit-11').click();
  await page.getByTestId('debugger-breakpoint-mode-11').selectOption('logpoint');
  await page.getByTestId('debugger-breakpoint-log-11').fill('{nums}');
  for (const expression of ['pivot * 2', 'arr.includes(pivot)']) {
    await page.getByTestId('debugger-watch-input').fill(expression);
    await page.getByTestId('debugger-watch-add').click();
  }
  await selectWorkflowMode(page, 'debug');
  await expect(page.getByTestId('run-meter-paused-line')).toHaveAttribute('data-line', '4');
  await page.getByTestId('debugger-hud-continue').click();
  await expect(page.getByTestId('run-meter-visit')).toHaveText('second visit');
  return errors;
}

async function expectInside(locator: Locator, page: Page) {
  const box = await locator.boundingBox();
  const width = page.viewportSize()!.width;
  expect(box, 'element is laid out').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
}

test('at 375 px every step control, dock tab and the call stack stay in reach', async ({ page }) => {
  const errors = await pauseInRecursion(page, 'ink');
  await page.setViewportSize({ width: 375, height: 812 });

  // The HUD folds to glyphs inside the editor; each control keeps its name.
  const hud = page.getByTestId('debugger-step-hud');
  await expect(hud).toHaveAttribute('data-fit', 'glyphs');
  for (const name of ['Continue', 'Step over', 'Step into', 'Step out', 'Run to end']) {
    await expectInside(hud.getByRole('button', { name }), page);
  }
  await expect(hud.getByRole('button', { name: 'Step over' })).toHaveAttribute('title', /^Step over \(F10\) · /u);

  // The changes switch leaves the tab row for the Locals head; every tab is reachable.
  const row = page.getByTestId('results-dock-tab-row');
  await expect(row.getByTestId('debugger-changes-switch')).toHaveCount(0);
  await expect(page.getByTestId('debugger-locals').getByTestId('debugger-changes-switch')).toBeVisible();
  for (const tab of await row.getByRole('tab').all()) await expectInside(tab, page);

  // Locals keep the current value whole; the old one drops under it.
  const arr = page.getByTestId('debugger-locals').locator('[data-local="arr"]');
  await expect(arr.getByTestId('answer-object-value')).toHaveText('1 – 8');
  const value = await arr.getByTestId('answer-object-value').evaluate(node => node.scrollWidth <= node.clientWidth);
  expect(value).toBe(true);

  await page.getByTestId('debugger-drawer').evaluate(node => node.scrollTo(0, node.scrollHeight));
  await expect(page.getByTestId('debugger-callstack-narrow')).toBeVisible();

  // The stop key reads as a key, not its token name.
  await expect(page.getByTestId('action-pill-run')).not.toContainText('Period');

  // Clicking the folded HUD and the keyboard both still step.
  await hud.getByRole('button', { name: 'Step over' }).click();
  await expect(page.getByTestId('run-meter-paused-line')).toHaveAttribute('data-line', '5');
  // A pause that starts in the narrow editor folds as well.
  await expect(hud).toHaveAttribute('data-fit', 'glyphs');
  await page.locator('.monaco-editor').click({ position: { x: 120, y: 20 } });
  await page.keyboard.press('F10');
  await expect(page.getByTestId('run-meter-paused-line')).toHaveAttribute('data-line', '6');
  await page.keyboard.press('F5');
  await expect(page.getByTestId('debugger-step-hud')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Paper keeps struck values, tags and errors legible on changed rows', async ({ page }) => {
  const errors = await pauseInRecursion(page, 'paper');
  await page.getByTestId('bottom-panel-debugger-tab').click();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'paper');

  // The expression keeps its width; its error wraps under it.
  const failing = page.getByTestId('debugger-watches').locator('li[data-error]');
  await expect(failing.locator('.debugger-watch-expression')).toHaveText('arr.includes(pivot)');
  const cut = await failing.locator('.debugger-watch-expression').evaluate(node => node.scrollWidth > node.clientWidth);
  expect(cut).toBe(false);

  // Each node's text colour and the background layers behind it, from the node out to the first opaque one.
  const samples = await page.getByTestId('debugger-drawer').evaluate(drawer => {
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return { r: r! / 255, g: g! / 255, b: b! / 255, a: a! / 255 };
    };
    const nodes = drawer.querySelectorAll<HTMLElement>(
      '[data-change] .answer-delta-before, [data-change] .type-tag, [data-change] [data-testid="answer-object-value"], [data-error] .debugger-error'
    );
    return [...nodes].map(node => {
      const layers = [];
      for (let element: HTMLElement | null = node; element; element = element.parentElement) {
        const layer = rgba(getComputedStyle(element).backgroundColor);
        if (layer.a > 0) layers.push(layer);
        if (layer.a >= 1) break;
      }
      return { text: node.textContent, color: rgba(getComputedStyle(node).color), layers };
    });
  });
  const ratios = samples.map(({ text, color, layers }) => {
    const ground = layers.reduceRight<Rgba>((under, layer) => over(layer, under), { r: 1, g: 1, b: 1, a: 1 });
    return { text, ratio: contrastRatio(color, ground) };
  });
  expect(ratios.length).toBeGreaterThan(4);
  for (const { text, ratio } of ratios) expect(ratio, `${text}`).toBeGreaterThanOrEqual(4.5);

  // A logpoint reads as a ringed minus in the gutter and in the list.
  await expect(page.locator('.monaco-editor .lingua-bp-glyph--logpoint')).toHaveCount(1);
  await expect(page.getByTestId('debugger-breakpoint-line-11').locator('svg.lucide-circle-minus')).toHaveCount(1);
  expect(errors).toEqual([]);
});
