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
