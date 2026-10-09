import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDefaultTab, useEditorStore } from '@/stores/editorStore';
import { useSettingsStore } from '@/stores/settingsStore';

const bridge = Object.getOwnPropertyDescriptor(window, 'lingua');
const initialEditor = useEditorStore.getState();
const initialSettings = useSettingsStore.getState();
beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useSettingsStore.setState({ formatOnSave: false });
  Object.defineProperty(window, 'lingua', {
    configurable: true,
    value: { fs: { write: vi.fn() } },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  useEditorStore.setState(initialEditor, true);
  useSettingsStore.setState(initialSettings, true);
  if (bridge) Object.defineProperty(window, 'lingua', bridge);
  else Reflect.deleteProperty(window, 'lingua');
});

it.each(['edit', 'clear', 'named-set', 'workflow', 'timeout'] as const)(
  'preserves a newer %s change while an unchanged-language save is pending',
  async change => {
    let resolveWrite!: (value: boolean) => void;
    const write = vi.spyOn(window.lingua.fs, 'write').mockImplementation(
      () =>
        new Promise(resolve => {
          resolveWrite = resolve;
        })
    );
    const tab = {
      ...createDefaultTab('javascript'),
      name: 'demo.js',
      filePath: '/tmp/demo.js',
      rootId: 'root-demo',
      relativePath: 'demo.js',
      stdinBuffer: 'old input',
    };
    useEditorStore.getState().addTab(tab);
    const pending = useEditorStore.getState().saveTabById(tab.id);
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    const store = useEditorStore.getState();
    if (change === 'edit') store.setTabStdinBuffer(tab.id, 'new input');
    if (change === 'clear') store.setTabStdinBuffer(tab.id, null);
    if (change === 'named-set') {
      store.setTabStdinBuffer(tab.id, 'new input');
      store.setTabInputArgs(tab.id, ['--fixture']);
      store.saveTabInputSet(tab.id, 'New case');
    }
    if (change === 'workflow') store.setTabWorkflowMode(tab.id, 'run');
    if (change === 'timeout') store.setTabNextRunTimeoutOverride(tab.id, 60_000);
    const live = useEditorStore.getState().tabs.find(t => t.id === tab.id)!;
    resolveWrite(true);
    expect(await pending).toBe(true);
    const saved = useEditorStore.getState().tabs.find(t => t.id === tab.id)!;
    for (const key of [
      'stdinBuffer',
      'inputArgs',
      'inputSets',
      'activeInputSetId',
      'workflowMode',
      'nextRunTimeoutOverrideMs',
    ] as const) {
      expect(saved[key], key).toEqual(live[key]);
    }
    expect(saved.isDirty).toBe(false);
  }
);

it('keeps an armed timeout override when a plain save writes a retitled tab', async () => {
  const write = vi.spyOn(window.lingua.fs, 'write').mockResolvedValue(true);
  // The tab was retitled in place; a plain save still writes demo.js without a picker.
  const tab = {
    ...createDefaultTab('javascript'),
    name: 'renamed.js',
    filePath: '/tmp/demo.js',
    rootId: 'root-demo',
    relativePath: 'demo.js',
    nextRunTimeoutOverrideMs: 60_000,
  };
  useEditorStore.getState().addTab(tab);
  expect(await useEditorStore.getState().saveTabById(tab.id)).toBe(true);
  expect(write).toHaveBeenCalledOnce();
  const saved = useEditorStore.getState().tabs.find(t => t.id === tab.id)!;
  expect(saved.name).toBe('demo.js');
  expect(saved.nextRunTimeoutOverrideMs).toBe(60_000);
});

it('drops a recipe binding from the tab when the save drops it', async () => {
  vi.spyOn(window.lingua.fs, 'write').mockResolvedValue(true);
  // A restored binding on a language where recipes cannot run.
  const tab = {
    ...createDefaultTab('go'),
    name: 'main.go',
    filePath: '/tmp/main.go',
    rootId: 'root-demo',
    relativePath: 'main.go',
    recipeBindingId: 'recipe-1',
  };
  // Seed directly: the Free tier would refuse to open a Go tab through addTab.
  useEditorStore.setState({ tabs: [tab], activeTabId: tab.id });
  const ok = await useEditorStore.getState().saveTabById(tab.id);
  expect(ok).toBe(true);
  const saved = useEditorStore.getState().tabs.find(t => t.id === tab.id)!;
  expect(saved.recipeBindingId).toBeUndefined();
});
