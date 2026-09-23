import {
  createAdditionalJavaScriptTab,
  createJavaScriptTab,
  expect,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';

for (const width of [1024, 1280, 1440]) {
  for (const language of ['en', 'es'] as const) {
    test(`action pill leaves editor tabs usable at ${width}px in ${language}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 768 });
      await seedSession(page, { language });
      await gotoApp(page);
      await createJavaScriptTab(page);
      await createAdditionalJavaScriptTab(page);
      await createAdditionalJavaScriptTab(page);

      const geometry = await page.evaluate(() => {
        const pill = document.querySelector<HTMLElement>('[data-testid="floating-action-pill"]');
        if (!pill) throw new Error('Action pill is missing');
        const pillRect = pill.getBoundingClientRect();
        const tabs = [...document.querySelectorAll<HTMLElement>('[data-tab-id]')];
        return {
          pill: { left: pillRect.left, right: pillRect.right, width: pillRect.width },
          viewportWidth: window.innerWidth,
          tabs: tabs.map(tab => {
            const activation = tab.querySelector<HTMLElement>(
              '[data-testid="editor-tab-activation"]'
            );
            if (!activation) throw new Error('Tab activation is missing');
            const rect = activation.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2
            );
            return { id: tab.dataset.tabId, hitTab: hit?.closest('[data-tab-id]') === tab };
          }),
        };
      });

      expect(geometry.pill.left).toBeGreaterThanOrEqual(0);
      expect(geometry.pill.right).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.tabs.length).toBeGreaterThanOrEqual(3);
      expect(
        geometry.tabs.every(tab => tab.hitTab),
        JSON.stringify(geometry)
      ).toBe(true);

      const tabs = page.locator('[data-tab-id]');
      const lastTab = tabs.last();
      await lastTab.getByTestId('editor-tab-activation').click();
      await expect(lastTab.getByTestId('editor-tab-activation')).toHaveAttribute(
        'aria-current',
        'page'
      );
      await lastTab.hover();
      await lastTab.locator('[data-tab-close="true"]').click();
      await expect(tabs).toHaveCount(2);

      const firstTab = tabs.first().getByTestId('editor-tab-activation');
      await firstTab.focus();
      await page.keyboard.press('ArrowRight');
      await expect(tabs.nth(1).getByTestId('editor-tab-activation')).toHaveAttribute(
        'aria-current',
        'page'
      );
      await page.screenshot({
        path: test.info().outputPath(`tab-layout-${width}-${language}.png`),
      });
    });
  }
}

// These CSS widths model a 1024/1280/1440px window at 200% browser zoom.
for (const width of [512, 640, 720]) {
  for (const language of ['en', 'es'] as const) {
    test(`action pill stays usable at narrow ${width}px in ${language}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 768 });
      await seedSession(page, { language });
      await gotoApp(page);
      await createJavaScriptTab(page);

      const pill = page.getByTestId('floating-action-pill');
      await expect(pill).toBeVisible();
      const box = await pill.boundingBox();
      if (!box) throw new Error('Action pill is missing');
      expect(box.x).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
      await expect(page.getByTestId('action-pill-run')).toBeVisible();
      await expect(page.getByTestId('action-pill-quick-open')).toBeHidden();

      const overflow = page.getByTestId('action-pill-overflow');
      await expect(overflow).toHaveAttribute(
        'aria-label',
        language === 'es' ? 'Más acciones' : 'More actions'
      );
      await overflow.click();
      const menu = page.getByRole('menu', {
        name: language === 'es' ? 'Más acciones' : 'More actions',
      });
      await expect(menu).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath(`action-overflow-${width}-${language}.png`),
      });
      const items = menu.getByRole('menuitem');
      await expect(items).toHaveCount(7);
      await expect(items.first()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press('End');
      await expect(items.last()).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(overflow).toBeFocused();

      await overflow.click();
      await page.getByTestId('action-pill-overflow-quick-open').click();
      await expect(page.getByPlaceholder(/go to file|ir al archivo/i)).toBeVisible();
      await page.keyboard.press('Escape');
      await overflow.click();
      await page.getByTestId('action-pill-overflow-settings').click();
      await expect(
        page.getByRole('heading', {
          name: /tune the shell, editor, and runtime defaults|ajusta el shell, el editor y los valores predeterminados del entorno/i,
        })
      ).toBeVisible();
    });
  }
}
