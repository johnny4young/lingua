import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEditorStore, createDefaultTab } from '@/stores/editorStore';
import { pluginRegistry } from '@/plugins';
import { luaPlugin } from '@/plugins/lua-runner';

describe('editorStore', () => {
  const initialState = useEditorStore.getState();

  beforeEach(() => {
    useEditorStore.setState({
      tabs: [],
      activeTabId: null,
    });
    if (!pluginRegistry.get(luaPlugin.id)) {
      pluginRegistry.register(luaPlugin);
    }

    Object.defineProperty(globalThis, 'window', {
      value: {
        lingua: {
          fs: {
            read: vi.fn().mockResolvedValue('file content'),
            write: vi.fn().mockResolvedValue(true),
            selectFile: vi.fn().mockResolvedValue(null),
            saveDialog: vi.fn().mockResolvedValue(null),
          },
          confirmCloseTab: vi.fn().mockResolvedValue(2), // Cancel by default
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    useEditorStore.setState(initialState, true);
  });

  it('should start with no tabs', () => {
    const state = useEditorStore.getState();
    expect(state.tabs).toHaveLength(0);
    expect(state.activeTabId).toBeNull();
  });

  it('should create a default tab with correct language content', () => {
    const tab = createDefaultTab('javascript');
    expect(tab.language).toBe('javascript');
    expect(tab.name).toMatch(/\.js$/);
    expect(tab.content).toContain('console.log');
    expect(tab.id).toBeTruthy();
  });

  it('should add a tab and set it active', () => {
    const tab = createDefaultTab('javascript');
    useEditorStore.getState().addTab(tab);

    const state = useEditorStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe(tab.id);
    expect(state.tabs[0].isDirty).toBe(false);
  });

  it('should update tab content and mark dirty', () => {
    const tab = createDefaultTab('typescript');
    const { addTab } = useEditorStore.getState();
    addTab(tab);

    useEditorStore.getState().updateContent(tab.id, 'const x: number = 42;');

    const state = useEditorStore.getState();
    expect(state.tabs[0].content).toBe('const x: number = 42;');
    expect(state.tabs[0].isDirty).toBe(true);
  });

  it('should remove a tab', () => {
    const tab1 = createDefaultTab('javascript');
    const tab2 = createDefaultTab('python');
    const { addTab } = useEditorStore.getState();
    addTab(tab1);
    addTab(tab2);

    useEditorStore.getState().removeTab(tab1.id);

    const state = useEditorStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].id).toBe(tab2.id);
  });

  it('should switch active tab when removing the active one', () => {
    const tab1 = createDefaultTab('javascript');
    const tab2 = createDefaultTab('python');
    const { addTab } = useEditorStore.getState();
    addTab(tab1);
    addTab(tab2);

    // tab2 is active (last added)
    useEditorStore.getState().removeTab(tab2.id);

    const state = useEditorStore.getState();
    expect(state.activeTabId).toBe(tab1.id);
  });

  it('should set active tab to null when removing the only tab', () => {
    const tab = createDefaultTab('go');
    useEditorStore.getState().addTab(tab);
    useEditorStore.getState().removeTab(tab.id);

    const state = useEditorStore.getState();
    expect(state.tabs).toHaveLength(0);
    expect(state.activeTabId).toBeNull();
  });

  it('should mark a tab as saved', () => {
    const tab = createDefaultTab('rust');
    useEditorStore.getState().addTab(tab);
    useEditorStore.getState().updateContent(tab.id, 'fn main() {}');
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);

    useEditorStore.getState().markSaved(tab.id);
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(false);
  });

  it('should create tabs for all supported languages', () => {
    const languages = ['javascript', 'typescript', 'go', 'python', 'rust'] as const;
    for (const lang of languages) {
      const tab = createDefaultTab(lang);
      expect(tab.language).toBe(lang);
      expect(tab.content.length).toBeGreaterThan(0);
    }
  });

  it('should create a default tab for a registered plugin language', () => {
    const tab = createDefaultTab('lua');
    expect(tab.language).toBe('lua');
    expect(tab.name).toMatch(/\.lua$/);
    expect(tab.content).toContain('Lua example');
  });

  describe('openFileFromDisk', () => {
    it('should do nothing if user cancels the file picker', async () => {
      (window.lingua.fs.selectFile as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await useEditorStore.getState().openFileFromDisk();
      expect(useEditorStore.getState().tabs).toHaveLength(0);
    });

    it('should open a file selected from the picker', async () => {
      (window.lingua.fs.selectFile as ReturnType<typeof vi.fn>).mockResolvedValue('/test/hello.ts');

      await useEditorStore.getState().openFileFromDisk();

      const { tabs } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].filePath).toBe('/test/hello.ts');
      expect(tabs[0].name).toBe('hello.ts');
      expect(tabs[0].language).toBe('typescript');
      expect(tabs[0].content).toBe('file content');
    });
  });

  describe('saveActiveTabAs', () => {
    it('should do nothing if user cancels the save dialog', async () => {
      const tab = createDefaultTab('javascript');
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().updateContent(tab.id, 'modified');

      await useEditorStore.getState().saveActiveTabAs();

      const { tabs } = useEditorStore.getState();
      expect(tabs[0].filePath).toBeUndefined();
      expect(tabs[0].isDirty).toBe(true);
    });

    it('should save and update tab identity on successful Save As', async () => {
      (window.lingua.fs.saveDialog as ReturnType<typeof vi.fn>).mockResolvedValue('/saved/script.py');

      const tab = createDefaultTab('python');
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().updateContent(tab.id, 'print("saved")');

      await useEditorStore.getState().saveActiveTabAs();

      const { tabs } = useEditorStore.getState();
      expect(tabs[0].filePath).toBe('/saved/script.py');
      expect(tabs[0].name).toBe('script.py');
      expect(tabs[0].language).toBe('python');
      expect(tabs[0].isDirty).toBe(false);
      expect(window.lingua.fs.write).toHaveBeenCalledWith('/saved/script.py', 'print("saved")');
    });
  });

  describe('saveActiveTab delegates to saveActiveTabAs for untitled tabs', () => {
    it('should open Save As when saving an untitled tab', async () => {
      (window.lingua.fs.saveDialog as ReturnType<typeof vi.fn>).mockResolvedValue('/new/file.js');

      const tab = createDefaultTab('javascript');
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().updateContent(tab.id, 'code');

      await useEditorStore.getState().saveActiveTab();

      expect(window.lingua.fs.saveDialog).toHaveBeenCalled();
    });
  });

  describe('closeTab', () => {
    it('should close a clean tab immediately', async () => {
      const tab = createDefaultTab('javascript');
      useEditorStore.getState().addTab(tab);

      const closed = await useEditorStore.getState().closeTab(tab.id);
      expect(closed).toBe(true);
      expect(useEditorStore.getState().tabs).toHaveLength(0);
    });

    it('should prompt for dirty tabs and respect Cancel', async () => {
      (window.lingua.confirmCloseTab as ReturnType<typeof vi.fn>).mockResolvedValue(2);

      const tab = createDefaultTab('javascript');
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().updateContent(tab.id, 'dirty');

      const closed = await useEditorStore.getState().closeTab(tab.id);
      expect(closed).toBe(false);
      expect(useEditorStore.getState().tabs).toHaveLength(1);
    });

    it('should close dirty tab on Discard', async () => {
      (window.lingua.confirmCloseTab as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const tab = createDefaultTab('go');
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().updateContent(tab.id, 'dirty');

      const closed = await useEditorStore.getState().closeTab(tab.id);
      expect(closed).toBe(true);
      expect(useEditorStore.getState().tabs).toHaveLength(0);
    });
  });

  describe('duplicateActiveTab', () => {
    it('should create a copy of the active tab', () => {
      const tab = createDefaultTab('rust');
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().updateContent(tab.id, 'fn main() {}');

      useEditorStore.getState().duplicateActiveTab();

      const { tabs } = useEditorStore.getState();
      expect(tabs).toHaveLength(2);
      expect(tabs[1].name).toBe(`Copy of ${tab.name}`);
      expect(tabs[1].content).toBe('fn main() {}');
      expect(tabs[1].language).toBe('rust');
      expect(tabs[1].filePath).toBeUndefined();
    });
  });
});
