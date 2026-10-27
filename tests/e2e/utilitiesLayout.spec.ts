import en from '../../src/renderer/i18n/locales/en/common.json';
import es from '../../src/renderer/i18n/locales/es/common.json';
import {
  closeDeveloperUtilities,
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

for (const language of ['en', 'es'] as const) {
  const copy = language === 'en' ? en : es;

  test(`Utilities drafts survive navigation, theme and repeated layout changes in ${language}`, async ({
    page,
  }) => {
    await seedSession(page, { language });
    await gotoApp(page);
    await createJavaScriptTab(page);
    const codeTabId = await page
      .locator('[data-tab-id]:has([aria-current="page"])')
      .getAttribute('data-tab-id');
    await openDeveloperUtilities(page);

    const jsonPanel = page.getByTestId('utility-panel-cache-json');
    const jsonInput = jsonPanel.getByRole('textbox', {
      name: copy['utilities.field.input'],
      exact: true,
    });
    const jsonDraft = '{"qa":17}';
    await jsonInput.fill(jsonDraft);
    await page.getByTestId('utility-item-base64').click();
    const base64Input = page.getByTestId('utility-panel-cache-base64').getByRole('textbox', {
      name: copy['utilities.field.input'],
      exact: true,
    });
    await base64Input.fill('layout draft 29');
    await page.getByTestId('utility-item-diff').click();
    const diffPanel = page.getByTestId('utility-panel-cache-diff');
    const left = diffPanel.getByRole('textbox', {
      name: copy['utilities.tool.diff.leftTitle'],
      exact: true,
    });
    const right = diffPanel.getByRole('textbox', {
      name: copy['utilities.tool.diff.rightTitle'],
      exact: true,
    });
    await left.fill('original layout draft');
    await right.fill('updated layout draft');

    // Switching workspace tabs must keep every visited utility's local fields.
    await page.locator(`[data-tab-id="${codeTabId}"]`).getByTestId('editor-tab-activation').click();
    await page
      .locator('[data-tab-id]')
      .filter({ hasText: 'Utilities' })
      .getByTestId('editor-tab-activation')
      .click();
    await expect(left).toHaveValue('original layout draft');

    // Theme is the control: changing it alone already preserved the drafts.
    await openSettings(page);
    await openSettingsTab(page, 'appearance');
    await page
      .getByRole('button', { name: copy['appearance.theme.light.label'], exact: true })
      .click();
    await closeSettings(page);
    await expect(left).toHaveValue('original layout draft');

    for (const preset of [
      'vertical',
      'horizontal',
      'vertical',
      'editor-only',
      'horizontal',
    ] as const) {
      await openSettings(page);
      await openSettingsTab(page, 'appearance');
      const key = preset === 'editor-only' ? 'editorOnly' : preset;
      await page
        .getByRole('button', { name: copy[`layout.preset.${key}.label`], exact: true })
        .click();
      await closeSettings(page);
      await expect(left).toHaveValue('original layout draft');
      await expect(right).toHaveValue('updated layout draft');
      await page.getByTestId('utility-item-json').click();
      await expect(jsonInput).toHaveValue(jsonDraft);
      await expect(jsonPanel.getByTestId('json-viewer-output')).toContainText('17');
      await page.getByTestId('utility-item-base64').click();
      await expect(base64Input).toHaveValue('layout draft 29');
      await page.getByTestId('utility-item-diff').click();
    }

    // In-progress invalid text is a draft too, without needing Apply or history.
    await page.getByTestId('utility-item-json').click();
    await jsonInput.fill('{"qa":');
    await openSettings(page);
    await openSettingsTab(page, 'appearance');
    await page
      .getByRole('button', { name: copy['layout.preset.vertical.label'], exact: true })
      .click();
    await closeSettings(page);
    await expect(jsonInput).toHaveValue('{"qa":');
    await expect(
      jsonPanel.getByText(copy['utilities.tool.json.invalid'], { exact: true })
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`utilities-layout-${language}.png`) });

    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    for (const draft of [
      'qa',
      'layout draft 29',
      'original layout draft',
      'updated layout draft',
    ]) {
      expect(storage).not.toContain(draft);
    }
    // Draft lifetime still ends when the Utilities tab closes or the app reloads.
    await closeDeveloperUtilities(page);
    await openDeveloperUtilities(page);
    await expect(jsonInput).not.toHaveValue('{"qa":');
    await jsonInput.fill(jsonDraft);
    await page.reload();
    await gotoApp(page);
    if (!(await page.getByTestId('developer-utilities-workspace').isVisible())) {
      await openDeveloperUtilities(page);
    }
    await expect(jsonInput).not.toHaveValue(jsonDraft);
  });
}

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
