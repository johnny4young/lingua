/** Real-layout project search coverage, including the no-project shortcut state. */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Project search — Cmd+Shift+F binding', () => {
  test('opens the overlay with empty-state when no project is open', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    // The shortcut handler uses `Mod+Shift+F`; Playwright maps
    // `Meta` → Cmd on macOS and `Control` on Linux/Windows.
    // `ControlOrMeta` keeps the spec portable across CI runners.
    await page.keyboard.press('ControlOrMeta+Shift+F');

    const dialog = page.getByRole('dialog', { name: /search in files/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Open a project to search across its files\./)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('localizes the empty-state copy in Spanish', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+F');

    const dialog = page.getByRole('dialog', { name: /buscar en archivos/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Abre un proyecto para buscar/)).toBeVisible();
  });
});

// Only the OS directory-picker boundary is synthetic. The web capability
// registry, search limits, store, virtualizer and file-open path stay real.
for (const language of ['en', 'es'] as const) {
  test(`windows capped folder results without scroll snapback (${language})`, async ({
    page,
  }, testInfo) => {
    await seedSession(page, { language, showStatusBar: true });
    await page.addInitScript(() => {
      const files = Array.from({ length: 60 }, (_, index) => {
        const name = `search-${String(index).padStart(3, '0')}.txt`;
        return {
          name,
          kind: 'file',
          getFile: async () =>
            new File(
              [
                Array.from(
                  { length: 10 },
                  (_, line) => `needle ${index < 50 ? 'exact' : 'extra'} ${index}:${line}`
                ).join('\n') + (index === 0 ? '\nunique' : ''),
              ],
              name
            ),
        };
      });
      const folder = {
        name: 'search-fixture',
        kind: 'directory',
        entries: async function* () {
          for (const file of files) yield [file.name, file];
        },
        getFileHandle: async (name: string) => {
          const file = files.find(file => file.name === name);
          if (!file) throw new DOMException('Missing fixture', 'NotFoundError');
          return file;
        },
        getDirectoryHandle: async () => {
          throw new DOMException('Missing fixture', 'NotFoundError');
        },
      };
      Object.defineProperty(window, 'showDirectoryPicker', { value: async () => folder });
    });
    await gotoApp(page);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            performance
              .getEntriesByType('resource')
              .filter(entry => /\/QuickOpen-[^/]+\.js$/.test(entry.name)).length
        )
      )
      .toBe(1);
    expect(
      await page.evaluate(
        () =>
          performance
            .getEntriesByType('resource')
            .filter(entry => /\/CommandPalette-[^/]+\.js$/.test(entry.name)).length
      )
    ).toBe(0);
    await page.keyboard.press('ControlOrMeta+Shift+P');
    const palette = page;
    await palette
      .getByRole('combobox')
      .fill(language === 'en' ? 'Open project folder' : 'Abrir carpeta de proyecto');
    await palette
      .getByRole('option', { name: language === 'en' ? /Open project folder/ : /Abrir carpeta/ })
      .click();
    await page.keyboard.press('ControlOrMeta+Shift+F');
    const dialog = page.getByRole('dialog', {
      name: language === 'en' ? /search in files/i : /buscar en archivos/i,
    });
    const input = dialog.getByRole('textbox');
    await input.fill('needle');
    const warning =
      language === 'en'
        ? /Showing the first 500 matches/
        : /Se muestran las primeras 500 coincidencias/;
    await expect(dialog.getByText(warning)).toBeVisible();
    await expect(page.getByTestId('live-announcer')).toContainText(warning);
    const rows = dialog.locator('[data-row-key]');
    const list = rows.first().locator('..');
    await expect.poll(() => rows.count()).toBeLessThan(90);
    const dimensions = await list.evaluate(node => ({
      height: node.clientHeight,
      scroll: node.scrollHeight,
    }));
    expect(dimensions.height).toBeGreaterThan(0);
    expect(dimensions.scroll).toBeGreaterThan(dimensions.height * 10);
    // Measured rows must include all spacing; an external header margin would
    // make the prefix-sum offsets disagree with actual browser geometry.
    expect(
      await rows.evaluateAll(nodes =>
        nodes
          .slice(1)
          .every(
            (node, index) =>
              Math.abs(
                node.getBoundingClientRect().top - nodes[index].getBoundingClientRect().bottom
              ) < 1
          )
      )
    ).toBe(true);
    const box = (await list.boundingBox())!;
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
    await page.mouse.wheel(0, 9000);
    await expect.poll(() => list.evaluate(node => node.scrollTop)).toBeGreaterThan(4000);
    await page.waitForTimeout(350); // allow scroll/ResizeObserver frames to settle
    expect(await list.evaluate(node => node.scrollTop)).toBeGreaterThan(4000);
    await expect(dialog.locator('[data-row-key="match:search-000.txt:1:1"]')).toHaveCount(0);
    await expect.poll(() => rows.count()).toBeLessThan(90);
    await testInfo.attach('search-window-metrics', {
      body: JSON.stringify(
        {
          language,
          availableMatches: 600,
          displayedMatchCap: 500,
          mountedRows: await rows.count(),
          viewport: dimensions,
          wheelScrollTop: await list.evaluate(node => node.scrollTop),
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    // Newly measured rows can grow the estimated scroll height. Keep wheeling
    // until the physical end settles, as with any variable-height virtual list.
    await expect
      .poll(async () => {
        await page.mouse.wheel(0, 100000);
        return list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop);
      })
      .toBeLessThan(1);
    await expect(dialog.locator('[data-row-key="match:search-049.txt:10:1"]')).toBeInViewport();
    await expect(dialog.locator('[data-row-key^="match:search-050.txt"]')).toHaveCount(0);
    // Keyboard selection can jump back to a row outside the mounted window.
    await input.press('ArrowDown');
    const selected = dialog.locator('[data-row-key="match:search-000.txt:2:1"]');
    await expect(selected).toBeInViewport();
    await expect(input).toBeFocused();
    await input.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(
      page
        .locator('[data-testid="editor-tab-activation"][aria-current="page"]')
        .filter({ hasText: 'search-000.txt' })
    ).toBeVisible();
    await expect(page.getByTestId('status-bar-cursor')).toContainText(/2.*1/);
    await page.keyboard.press('ControlOrMeta+Shift+F');
    await input.fill('exact');
    await expect(
      dialog.getByText(
        language === 'en' ? /500 matches in 50 files/ : /500 coincidencias en 50 archivos/
      )
    ).toBeVisible();
    await expect(dialog.getByText(warning)).toHaveCount(0);
    await input.fill('unique');
    await expect(dialog.getByText(warning)).toHaveCount(0);
    await expect(dialog.locator('button[data-row-key]')).toHaveCount(1);
    await input.fill('absent-query');
    await expect(
      dialog.getByText(language === 'en' ? /No matches/ : /Sin coincidencias/)
    ).toBeVisible();
    // Exercise the primary bridge error after a capped result, not only empty.
    await input.fill('needle');
    await expect(dialog.getByText(warning)).toBeVisible();
    await page.evaluate(() => {
      window.lingua.fs.searchInFiles = async () => {
        throw new Error('fixture search failure');
      };
    });
    await input.fill('failure');
    await expect(dialog.getByText(/fixture search failure/)).toBeVisible();
    await expect(dialog.getByText(warning)).toHaveCount(0);
    // The shared fixture asserts zero unexpected console errors/page errors.
  });
}
