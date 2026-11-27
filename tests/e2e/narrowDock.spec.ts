import type { Page } from '@playwright/test';
import {
  createJavaScriptTab,
  expect,
  expectNoHorizontalOverflow,
  gotoApp,
  openConsole,
  seedSession,
  test,
  waitForInitialAutoRunCompleted,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

const PACKS = {
  ink: { theme: 'dark', editorTheme: 'lingua-ink' },
  paper: { theme: 'light', editorTheme: 'lingua-paper' },
} as const;

/** Dock row and console filter geometry: tabs reachable in their track, controls on screen and apart. */
function dockGeometry(page: Page) {
  return page.evaluate(() => {
    type Box = { name: string; left: number; right: number; top: number; bottom: number };
    const row = document.querySelector<HTMLElement>('[data-testid="results-dock-tab-row"]');
    const list = row?.querySelector<HTMLElement>('[role="tablist"]');
    const toolbar = document.querySelector<HTMLElement>('.console-toolbar');
    if (!row || !list || !toolbar) throw new Error('Dock row or console toolbar is missing');
    const box = (element: HTMLElement, name: string): Box => {
      const rect = element.getBoundingClientRect();
      return { name, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const name = (element: HTMLElement) =>
      element.getAttribute('aria-label') ?? element.dataset.testid ?? element.textContent?.trim() ?? '?';

    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
    const unreachable: string[] = [];
    for (const tab of tabs) {
      // Bring each tab into the row's own track, then hit-test its centre.
      const listRect = list.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      if (tabRect.left < listRect.left) list.scrollLeft -= listRect.left - tabRect.left;
      else if (tabRect.right > listRect.right) list.scrollLeft += tabRect.right - listRect.right;
      const rect = tab.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!tab.contains(hit) || rect.left < 0 || rect.right > window.innerWidth) unreachable.push(name(tab));
    }
    list.scrollLeft = 0;

    const listRect = list.getBoundingClientRect();
    const visibleTabs = tabs
      .map(tab => box(tab, tab.textContent?.trim() ?? '?'))
      .filter(tab => tab.right <= listRect.right + 0.5 && tab.left >= listRect.left - 0.5);
    const rowControls = [...row.querySelectorAll<HTMLElement>('button')]
      .filter(button => button.getAttribute('role') !== 'tab' && button.getClientRects().length > 0)
      .map(button => box(button, name(button)));
    const consoleControls = [...toolbar.querySelectorAll<HTMLElement>('button, input')]
      .filter(control => control.getClientRects().length > 0 && !control.closest('[role="group"]'))
      .map(control => box(control, name(control)));
    const levelGroup = toolbar.querySelector<HTMLElement>('[role="group"]');
    if (levelGroup) consoleControls.push(box(levelGroup, 'level'));

    const overlaps: string[] = [];
    for (const controls of [[...visibleTabs, ...rowControls], consoleControls]) {
      controls.forEach((a, i) =>
        controls.slice(i + 1).forEach(b => {
          const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (x > 0.5 && y > 0.5) overlaps.push(`${a.name} × ${b.name}`);
        })
      );
    }
    const offscreen = [...rowControls, ...consoleControls]
      .filter(control => control.left < 0 || control.right > window.innerWidth + 0.5)
      .map(control => control.name);
    return { tabs: tabs.length, unreachable, overlaps, offscreen };
  });
}

function gutterWidths(page: Page) {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>('.monaco-editor');
    const margin = editor?.querySelector<HTMLElement>('.margin');
    const glyphs = editor?.querySelector<HTMLElement>('.glyph-margin');
    return {
      editor: editor?.getBoundingClientRect().width ?? 0,
      margin: margin?.getBoundingClientRect().width ?? 0,
      glyphs: glyphs?.getBoundingClientRect().width ?? 0,
    };
  });
}

for (const palette of ['ink', 'paper'] as const) {
  test(`dock row, console filters and gutter fit a 375 px window in ${palette}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await seedSession(page, { language: 'en', appearance: PACKS[palette] });
    await gotoApp(page);
    await expect(page.locator('html')).toHaveAttribute('data-palette', palette);
    await createJavaScriptTab(page);
    await openConsole(page);
    await waitForInitialAutoRunCompleted(page);

    await expectNoHorizontalOverflow(page);
    const geometry = await dockGeometry(page);
    expect(geometry.tabs).toBeGreaterThanOrEqual(3);
    expect(geometry, JSON.stringify(geometry)).toMatchObject({ unreachable: [], overlaps: [], offscreen: [] });

    // Tabs read as glyphs and keep their names.
    await expect(page.getByRole('tab', { name: /^Console/ })).toBeVisible();
    await expect(page.getByTestId('results-dock')).toHaveAttribute('data-compact', 'true');
    await expect(page.getByTestId('results-dock-tab-row')).toHaveAttribute('data-fit', 'glyphs');
    await expect(page.getByTestId('bottom-panel-console-tab').locator('.dock-tab-label')).toHaveCSS('clip-path', 'inset(50%)');
    await page.getByTestId('bottom-panel-stdin-tab').hover();
    await expect(page.getByRole('tooltip')).toContainText(/^Input · /);
    await page.mouse.move(0, 0);

    // Share leaves the row for the overflow menu.
    await expect(page.getByTestId('result-panel-share-link')).toHaveCount(0);
    await page.getByTestId('dock-more').click();
    const menu = page.getByRole('menu', { name: 'More dock actions' });
    await expect(menu.getByRole('menuitem', { name: 'Copy share link' })).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(375);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId('dock-more')).toBeFocused();

    // The gutter drops glyphs and folding; the run rail keeps its margin.
    await expect.poll(async () => (await gutterWidths(page)).glyphs).toBe(0);
    const narrow = await gutterWidths(page);
    expect(narrow.margin / narrow.editor).toBeLessThan(0.2);

    // Wide again: glyph margin, inline actions and labels come back.
    await page.setViewportSize({ width: 1024, height: 812 });
    await expect.poll(async () => (await gutterWidths(page)).glyphs).toBeGreaterThan(0);
    await expect(page.getByTestId('dock-more')).toHaveCount(0);
    await expect(page.getByTestId('result-panel-share-link')).toBeVisible();
    await expect(page.getByTestId('results-dock')).not.toHaveAttribute('data-compact', 'true');
    await expect(page.getByTestId('results-dock-tab-row')).not.toHaveAttribute('data-fit', 'glyphs');
    await expect(page.getByTestId('bottom-panel-console-tab').locator('.dock-tab-label')).toHaveCSS('clip-path', 'none');
  });
}
