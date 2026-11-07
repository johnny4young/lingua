import i18next from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { runActiveTab } from '../../src/renderer/runtime/manualRunController';
import { useConsoleStore } from '../../src/renderer/stores/consoleStore';
import { useEditorStore } from '../../src/renderer/stores/editorStore';

describe('running with no active file', () => {
  afterEach(async () => {
    await i18next.changeLanguage('en');
    useConsoleStore.getState().clear();
  });

  it.each([
    ['en', 'No active file to run.'],
    ['es', 'No hay un archivo activo para ejecutar.'],
  ])('says so in the Console in %s', async (language, message) => {
    await i18next.changeLanguage(language);
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useConsoleStore.getState().clear();
    await runActiveTab(() => {});
    expect(useConsoleStore.getState().entries.at(-1)).toMatchObject({ type: 'error', content: message });
  });
});
