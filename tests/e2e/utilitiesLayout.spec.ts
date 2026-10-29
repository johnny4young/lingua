import en from '../../src/renderer/i18n/locales/en/common.json';
import {
  closeSettings,
  createJavaScriptTab,
  expect,
  gotoApp,
  openDeveloperUtilities,
  openSettings,
  openSettingsTab,
  seedSession,
  test,
} from './licenseWeb.helpers';

test('Utilities drafts survive repeated layout changes', async ({ page }) => {
  await seedSession(page, { language: 'en' });
  await gotoApp(page);
  await createJavaScriptTab(page);
  await openDeveloperUtilities(page);

  const jsonInput = page
    .getByTestId('utility-panel-cache-json')
    .getByRole('textbox', { name: en['utilities.field.input'], exact: true });
  await jsonInput.fill('{"qa":17}');
  await page.getByTestId('utility-item-diff').click();
  const left = page
    .getByTestId('utility-panel-cache-diff')
    .getByRole('textbox', { name: en['utilities.tool.diff.leftTitle'], exact: true });
  await left.fill('original layout draft');

  for (const preset of ['vertical', 'horizontal', 'editor-only', 'vertical'] as const) {
    await openSettings(page);
    await openSettingsTab(page, 'appearance');
    const key = preset === 'editor-only' ? 'editorOnly' : preset;
    await page.getByRole('button', { name: en[`layout.preset.${key}.label`], exact: true }).click();
    await closeSettings(page);
    await expect(left).toHaveValue('original layout draft');
  }
  await page.getByTestId('utility-item-json').click();
  await expect(jsonInput).toHaveValue('{"qa":17}');
});

test('layout changes restore independent panel sizes and keep dock folding usable', async ({
  page,
}) => {
  await seedSession(page, { language: 'en' });
  await page.addInitScript(() => {
    for (const [orientation, workspace] of [
      ['horizontal', 72],
      ['vertical', 62],
    ] as const) {
      localStorage.setItem(
        `react-resizable-panels:lingua-main-${orientation}-layout:workspace-panel:console-panel`,
        JSON.stringify({ 'workspace-panel': workspace, 'console-panel': 100 - workspace })
      );
    }
  });
  await gotoApp(page);
  await createJavaScriptTab(page);
  await page.getByTestId('bottom-panel-console-tab').click();

  for (const preset of ['horizontal', 'vertical', 'horizontal', 'vertical'] as const) {
    await openSettings(page);
    await openSettingsTab(page, 'appearance');
    await page
      .getByRole('button', { name: en[`layout.preset.${preset}.label`], exact: true })
      .click();
    await closeSettings(page);
    await expect
      .poll(() =>
        page.evaluate(orientation => {
          const workspace = document.getElementById('workspace-panel');
          if (!workspace?.parentElement) throw new Error('Workspace panel is missing');
          const panel = workspace.getBoundingClientRect();
          const group = workspace.parentElement.getBoundingClientRect();
          return orientation === 'vertical'
            ? (panel.width / group.width) * 100
            : (panel.height / group.height) * 100;
        }, preset)
      )
      .toBeCloseTo(preset === 'vertical' ? 62 : 72, 0);

    await page.getByTestId('bottom-panel-hide').click();
    await expect(page.getByTestId('results-dock')).toHaveAttribute('data-expanded', 'false');
    await page.getByTestId('bottom-panel-console-tab').click();
    await expect(page.getByTestId('results-dock')).toHaveAttribute('data-expanded', 'true');
  }
});
