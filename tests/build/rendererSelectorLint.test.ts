// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();
async function restrictions(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(message => message.ruleId === 'no-restricted-syntax');
}

describe('renderer selector lint composition', () => {
  it.each([
    'tabs.find(tab => tab.id === activeTabId);',
    'state.tabs.find(tab => tab.id === state.activeTabId);',
    'useSettingsStore();',
  ])('rejects %s inside components', async source => {
    expect(await restrictions(source, 'src/renderer/components/Probe.tsx')).toHaveLength(1);
  });
  it('allows selected reads and imperative access', async () => {
    expect(
      await restrictions(
        'useSettingsStore(s => s.theme); useSettingsStore.getState();',
        'src/renderer/components/Probe.tsx'
      )
    ).toHaveLength(0);
  });
  it('preserves the canonical selector exemption and component-only store ban', async () => {
    const source = 'tabs.find(tab => tab.id === activeTabId); useEditorStore();';
    expect(await restrictions(source, 'src/renderer/stores/editorSelectors.ts')).toHaveLength(0);
    expect(await restrictions(source, 'src/renderer/hooks/probe.ts')).toHaveLength(1);
  });
});
