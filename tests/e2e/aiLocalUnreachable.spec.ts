import {
  clickRun,
  createJavaScriptTab,
  expect,
  gotoApp,
  replaceEditorText,
  seedSession,
  test,
  waitForRunCompleted,
} from './licenseWeb.helpers';

const LOCAL = 'http://localhost:1234/v1/chat/completions';
const FAILING = ['const user = null;', 'console.log(user.name);'].join('\n');
const HINT = {
  en: 'No answer from the model server at localhost:1234. Check that it is running and accepts requests from Lingua. LM Studio needs Enable CORS on in its server settings.',
  es: 'No hubo respuesta del servidor del modelo en localhost:1234. Revisa que esté corriendo y acepte solicitudes de Lingua. LM Studio necesita activar Enable CORS en la configuración de su servidor.',
};

for (const language of ['en', 'es'] as const) {
  test(`a local model server without CORS names its address and the LM Studio option in ${language}`, async ({ page, consoleErrors }) => {
    await seedSession(page, { language, primeProLicense: true, workflowModeDefaultsByLanguage: { javascript: 'run' } });
    await page.addInitScript(
      (endpoint) =>
        localStorage.setItem('lingua-ai', JSON.stringify({ state: { endpoint, apiKey: '', model: 'lm-fixture' }, version: 1 })),
      LOCAL
    );
    // A refused CORS preflight and a stopped server both reject fetch; a fulfilled
    // route would skip Chromium's CORS check.
    await page.route(LOCAL, (route) => route.abort('failed'));
    await gotoApp(page);
    await createJavaScriptTab(page);
    await replaceEditorText(page, FAILING);
    await clickRun(page);
    await waitForRunCompleted(page);
    await page.getByTestId('error-line-explain').click();
    const panel = page.getByTestId('ai-explain-panel');
    await panel.getByTestId('ai-explain-send').click();
    await expect(panel.getByTestId('ai-explain-error')).toHaveText(HINT[language]);
    await page.screenshot({ path: `output/playwright/ai-local-unreachable-${language}.png` });
    // Chromium logs the aborted request itself; nothing else may log an error.
    const unrelated = consoleErrors.filter((text) => text !== 'Failed to load resource: net::ERR_FAILED');
    consoleErrors.splice(0, consoleErrors.length, ...unrelated);
  });
}
