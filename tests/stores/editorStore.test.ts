import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockTrackEvent } = vi.hoisted(() => ({
  mockTrackEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/telemetry', () => ({
  trackEvent: mockTrackEvent,
}));

import {
  useEditorStore,
  createDefaultTab,
  SQL_WORKSPACE_TAB_ID,
  HTTP_WORKSPACE_TAB_ID,
} from '@/stores/editorStore';
import { useDependencyDetectionStore } from '@/stores/dependencyDetectionStore';
import {
  resetRecipeStoreForTests,
  useRecipeStore,
} from '@/stores/recipeStore';
import {
  resetNotebookStoreForTests,
  useNotebookStore,
} from '@/stores/notebookStore';
import { useLicenseStore } from '@/stores/licenseStore';
import { useUIStore } from '@/stores/uiStore';
import { pluginRegistry } from '@/plugins';
import { luaPlugin } from '@/plugins/lua-runner';

function setActiveProLicense(): void {
  // The existing editor-store suite predates RL-060 and opens multiple
  // tabs per test. Seed a Pro license so those flows bypass the Free
  // ceiling — each RL-060 gate test below resets the tier back to free
  // inside its own body.
  useLicenseStore.setState({
    token: 'test.token',
    status: {
      kind: 'active',
      verification: {
        ok: true,
        state: 'active',
        supportWindowEndsAt: Date.now() + 86_400_000,
        payload: {
          productId: 'lingua-desktop',
          tier: 'pro',
          issuedTo: 'test@example.com',
          issuedAt: new Date().toISOString(),
          supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
          entitlements: [],
        },
      },
    },
    lastVerifiedAt: Date.now(),
  });
}

describe('editorStore', () => {
  const initialState = useEditorStore.getState();
  const initialUIState = useUIStore.getState();

  beforeEach(() => {
    useDependencyDetectionStore.getState().clear();
    useEditorStore.setState({
      tabs: [],
      activeTabId: null,
    });
    resetRecipeStoreForTests();
    resetNotebookStoreForTests();
    useUIStore.setState({ statusNotice: null });
    setActiveProLicense();
    if (!pluginRegistry.get(luaPlugin.id)) {
      pluginRegistry.register(luaPlugin);
    }

    Object.defineProperty(globalThis, 'window', {
      value: {
        lingua: {
          fs: {
            read: vi.fn().mockResolvedValue('file content'),
            write: vi.fn().mockResolvedValue(true),
            selectFile: vi.fn().mockResolvedValue({ canceled: true }),
            saveDialog: vi.fn().mockResolvedValue({ canceled: true }),
            reopenRoot: vi
              .fn()
              .mockResolvedValue({ ok: false, error: 'not-found' }),
            revokeRoot: vi.fn().mockResolvedValue(true),
          },
          confirmCloseTab: vi.fn().mockResolvedValue(2), // Cancel by default
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    useDependencyDetectionStore.getState().clear();
    resetRecipeStoreForTests();
    resetNotebookStoreForTests();
    useEditorStore.setState(initialState, true);
    useUIStore.setState(initialUIState, true);
    localStorage.clear();
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
    // RL-020 Slice 3 — the Scratchpad seed showcases `//=>` + the
    // pinned `// @watch` instead of a `console.log`. Asserting the
    // marker survives template refreshes (a contributor reverting
    // the demo would fail this test).
    expect(tab.content).toContain('@watch');
    expect(tab.content).toContain('//=>');
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
      (window.lingua.fs.selectFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: true,
      });

      await useEditorStore.getState().openFileFromDisk();
      expect(useEditorStore.getState().tabs).toHaveLength(0);
    });

    it('should open a file selected from the picker', async () => {
      (window.lingua.fs.selectFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        rootId: 'root-1',
        rootPath: '/test',
        fileRelativePath: 'hello.ts',
        fileName: 'hello.ts',
        content: 'file content',
      });

      await useEditorStore.getState().openFileFromDisk();

      const { tabs } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].filePath).toBe('/test/hello.ts');
      expect(tabs[0].rootId).toBe('root-1');
      expect(tabs[0].relativePath).toBe('hello.ts');
      expect(tabs[0].name).toBe('hello.ts');
      expect(tabs[0].language).toBe('typescript');
      expect(tabs[0].content).toBe('file content');
    });

    it('builds a sane display path for web single-file capabilities', async () => {
      (window.lingua.fs.selectFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        rootId: 'root-web-single',
        rootPath: '/',
        fileRelativePath: 'hello.ts',
        fileName: 'hello.ts',
        content: 'file content',
      });

      await useEditorStore.getState().openFileFromDisk();

      const { tabs } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].filePath).toBe('/hello.ts');
    });

    it('activates an already-open file and revokes the newly minted picker root', async () => {
      const existing: ReturnType<typeof createDefaultTab> = {
        ...createDefaultTab('typescript'),
        id: 'existing-tab',
        name: 'hello.ts',
        filePath: '/test/hello.ts',
        rootId: 'root-existing',
        relativePath: 'hello.ts',
        content: 'old content',
      };
      useEditorStore.getState().addTab(existing);
      (window.lingua.fs.selectFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        rootId: 'root-new',
        rootPath: '/test',
        fileRelativePath: 'hello.ts',
        fileName: 'hello.ts',
        content: 'new content',
      });

      await useEditorStore.getState().openFileFromDisk();

      const { tabs, activeTabId } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(activeTabId).toBe('existing-tab');
      expect(window.lingua.fs.revokeRoot).toHaveBeenCalledWith('root-new');
    });

    it('should open unknown extensions in plaintext instead of forcing javascript', async () => {
      (window.lingua.fs.selectFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        rootId: 'root-2',
        rootPath: '/test',
        fileRelativePath: 'notes.txt',
        fileName: 'notes.txt',
        content: 'just text',
      });

      await useEditorStore.getState().openFileFromDisk();

      const { tabs } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].name).toBe('notes.txt');
      expect(tabs[0].language).toBe('plaintext');
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
      (window.lingua.fs.saveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        rootId: 'root-save-1',
        rootPath: '/saved',
        fileRelativePath: 'script.py',
      });

      const tab = createDefaultTab('python');
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().updateContent(tab.id, 'print("saved")');

      await useEditorStore.getState().saveActiveTabAs();

      const { tabs } = useEditorStore.getState();
      expect(tabs[0].filePath).toBe('/saved/script.py');
      expect(tabs[0].rootId).toBe('root-save-1');
      expect(tabs[0].relativePath).toBe('script.py');
      expect(tabs[0].name).toBe('script.py');
      expect(tabs[0].language).toBe('python');
      expect(tabs[0].isDirty).toBe(false);
      expect(window.lingua.fs.write).toHaveBeenCalledWith(
        'root-save-1',
        'script.py',
        'print("saved")'
      );
    });

    it('does not write notebook tabs as empty files before disk persistence ships', async () => {
      const tabId = useEditorStore
        .getState()
        .addNotebookTab({ title: 'Notebook draft' });
      expect(tabId).toBeTruthy();

      await useEditorStore.getState().saveActiveTabAs();

      expect(window.lingua.fs.saveDialog).not.toHaveBeenCalled();
      expect(window.lingua.fs.write).not.toHaveBeenCalled();
      expect(useUIStore.getState().statusNotice).toMatchObject({
        tone: 'info',
        messageKey: 'notebook.notice.diskPersistencePending',
      });
    });

    it('keeps only the file name when Save As returns a Windows root path', async () => {
      (window.lingua.fs.saveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        rootId: 'root-save-win',
        rootPath: 'C:\\saved',
        fileRelativePath: 'script.py',
      });

      const tab = createDefaultTab('python');
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().updateContent(tab.id, 'print("saved")');

      await useEditorStore.getState().saveActiveTabAs();

      const { tabs } = useEditorStore.getState();
      expect(tabs[0].filePath).toBe('C:\\saved\\script.py');
      expect(tabs[0].name).toBe('script.py');
      expect(tabs[0].language).toBe('python');
    });

    it('should keep unknown Save As targets in plaintext', async () => {
      (window.lingua.fs.saveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        rootId: 'root-save-2',
        rootPath: '/saved',
        fileRelativePath: 'notes.txt',
      });

      const tab = createDefaultTab('javascript');
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().updateContent(tab.id, 'plain text');
      useEditorStore.getState().setTabAutoLogEnabled(tab.id, true);

      await useEditorStore.getState().saveActiveTabAs();

      const { tabs } = useEditorStore.getState();
      expect(tabs[0].filePath).toBe('/saved/notes.txt');
      expect(tabs[0].name).toBe('notes.txt');
      expect(tabs[0].language).toBe('plaintext');
      expect(tabs[0].autoLogEnabled).toBeUndefined();
      expect(tabs[0].isDirty).toBe(false);
    });

    it('revokes the previous tab-private root after Save As moves the tab to a new capability', async () => {
      (window.lingua.fs.saveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        rootId: 'root-save-new',
        rootPath: '/saved',
        fileRelativePath: 'script.py',
      });

      const tab: ReturnType<typeof createDefaultTab> = {
        ...createDefaultTab('python'),
        filePath: '/old/script.py',
        rootId: 'root-save-old',
        relativePath: 'script.py',
      };
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().updateContent(tab.id, 'print("moved")');

      await useEditorStore.getState().saveActiveTabAs();

      const { tabs } = useEditorStore.getState();
      expect(tabs[0].rootId).toBe('root-save-new');
      expect(window.lingua.fs.revokeRoot).toHaveBeenCalledWith('root-save-old');
      expect(window.lingua.fs.revokeRoot).not.toHaveBeenCalledWith('root-save-new');
    });

    it('revokes a picker-minted Save As capability when the write fails', async () => {
      (window.lingua.fs.saveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        rootId: 'root-save-fail',
        rootPath: '/saved',
        fileRelativePath: 'script.py',
      });
      (window.lingua.fs.write as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const tab = createDefaultTab('python');
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().updateContent(tab.id, 'print("not saved")');

      await useEditorStore.getState().saveActiveTabAs();

      expect(window.lingua.fs.revokeRoot).toHaveBeenCalledWith('root-save-fail');
      expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
    });

    it('revokes a picker-minted Save As capability when formatting throws before write', async () => {
      const { useSettingsStore } = await import('@/stores/settingsStore');
      useSettingsStore.setState({ formatOnSave: true });
      (window.lingua as unknown as {
        format: { gofmt: ReturnType<typeof vi.fn> };
      }).format = {
        gofmt: vi.fn().mockRejectedValue(new Error('formatter crashed')),
      };
      (window.lingua.fs.saveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        rootId: 'root-format-fail',
        rootPath: '/saved',
        fileRelativePath: 'main.go',
      });

      try {
        const tab = createDefaultTab('go');
        useEditorStore.getState().addTab(tab);
        useEditorStore.getState().updateContent(tab.id, 'package main');

        await expect(useEditorStore.getState().saveActiveTabAs()).rejects.toThrow(
          'formatter crashed'
        );

        expect(window.lingua.fs.write).not.toHaveBeenCalled();
        expect(window.lingua.fs.revokeRoot).toHaveBeenCalledWith('root-format-fail');
      } finally {
        useSettingsStore.setState({ formatOnSave: false });
      }
    });
  });

  describe('saveActiveTab delegates to saveActiveTabAs for untitled tabs', () => {
    it('should open Save As when saving an untitled tab', async () => {
      (window.lingua.fs.saveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        rootId: 'root-save-untitled',
        rootPath: '/new',
        fileRelativePath: 'file.js',
      });

      const tab = createDefaultTab('javascript');
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().updateContent(tab.id, 'code');

      await useEditorStore.getState().saveActiveTab();

      expect(window.lingua.fs.saveDialog).toHaveBeenCalled();
    });
  });

  describe('format-on-save', () => {
    it('formats JS before writing when the setting is on', async () => {
      const { useSettingsStore } = await import('@/stores/settingsStore');
      useSettingsStore.setState({ formatOnSave: true });
      try {
        const tab: ReturnType<typeof createDefaultTab> = {
          ...createDefaultTab('javascript'),
          filePath: '/tmp/demo.js',
          rootId: 'root-fmt-1',
          relativePath: 'demo.js',
        };
        useEditorStore.getState().addTab(tab);
        useEditorStore.getState().updateContent(tab.id, 'const  x=1\n');

        await useEditorStore.getState().saveActiveTab();

        expect(window.lingua.fs.write).toHaveBeenCalledWith(
          'root-fmt-1',
          'demo.js',
          'const x = 1;\n'
        );
        const { tabs } = useEditorStore.getState();
        expect(tabs[0]?.content).toBe('const x = 1;\n');
        expect(tabs[0]?.isDirty).toBe(false);
      } finally {
        useSettingsStore.setState({ formatOnSave: false });
      }
    });

    it('skips formatting when the setting is off', async () => {
      const tab: ReturnType<typeof createDefaultTab> = {
        ...createDefaultTab('javascript'),
        filePath: '/tmp/raw.js',
        rootId: 'root-raw',
        relativePath: 'raw.js',
      };
      useEditorStore.getState().addTab(tab);
      useEditorStore.getState().updateContent(tab.id, 'const  x=1\n');

      await useEditorStore.getState().saveActiveTab();

      expect(window.lingua.fs.write).toHaveBeenCalledWith(
        'root-raw',
        'raw.js',
        'const  x=1\n'
      );
    });

    it('falls back to the original content and pushes a status notice on parse errors', async () => {
      const { useSettingsStore } = await import('@/stores/settingsStore');
      const { useUIStore } = await import('@/stores/uiStore');
      useSettingsStore.setState({ formatOnSave: true });
      useUIStore.setState({ statusNotice: null });
      try {
        const tab: ReturnType<typeof createDefaultTab> = {
          ...createDefaultTab('json'),
          filePath: '/tmp/broken.json',
          rootId: 'root-broken',
          relativePath: 'broken.json',
        };
        useEditorStore.getState().addTab(tab);
        useEditorStore.getState().updateContent(tab.id, '{bad json');

        await useEditorStore.getState().saveActiveTab();

        expect(window.lingua.fs.write).toHaveBeenCalledWith(
          'root-broken',
          'broken.json',
          '{bad json'
        );
        const notice = useUIStore.getState().statusNotice;
        expect(notice?.messageKey).toBe('editor.formatOnSave.parseError');
        expect(notice?.tone).toBe('error');
      } finally {
        useSettingsStore.setState({ formatOnSave: false });
        useUIStore.setState({ statusNotice: null });
      }
    });

    it('does not touch unsupported languages even when the setting is on', async () => {
      const { useSettingsStore } = await import('@/stores/settingsStore');
      useSettingsStore.setState({ formatOnSave: true });
      try {
        const tab: ReturnType<typeof createDefaultTab> = {
          ...createDefaultTab('yaml'),
          filePath: '/tmp/data.yaml',
          rootId: 'root-yaml',
          relativePath: 'data.yaml',
        };
        useEditorStore.getState().addTab(tab);
        useEditorStore.getState().updateContent(tab.id, 'a:   1\nb:   2');

        await useEditorStore.getState().saveActiveTab();

        expect(window.lingua.fs.write).toHaveBeenCalledWith(
          'root-yaml',
          'data.yaml',
          'a:   1\nb:   2'
        );
      } finally {
        useSettingsStore.setState({ formatOnSave: false });
      }
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

    it('formats before closing a dirty tab when saving is requested', async () => {
      const { useSettingsStore } = await import('@/stores/settingsStore');
      useSettingsStore.setState({ formatOnSave: true });
      try {
        (window.lingua.confirmCloseTab as ReturnType<typeof vi.fn>).mockResolvedValue(0);

        const tab: ReturnType<typeof createDefaultTab> = {
          ...createDefaultTab('javascript'),
          filePath: '/tmp/close-me.js',
          rootId: 'root-close',
          relativePath: 'close-me.js',
        };
        useEditorStore.getState().addTab(tab);
        useEditorStore.getState().updateContent(tab.id, 'const  x=1\n');

        const closed = await useEditorStore.getState().closeTab(tab.id);

        expect(closed).toBe(true);
        expect(window.lingua.fs.write).toHaveBeenCalledWith(
          'root-close',
          'close-me.js',
          'const x = 1;\n'
        );
        expect(useEditorStore.getState().tabs).toHaveLength(0);
      } finally {
        useSettingsStore.setState({ formatOnSave: false });
      }
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

  describe('renameTab', () => {
    it('updates the tab name, re-derives the language from the extension, and marks it dirty', () => {
      const tab = createDefaultTab('python');
      useEditorStore.getState().addTab(tab);

      useEditorStore.getState().renameTab(tab.id, 'helper.go');

      const { tabs } = useEditorStore.getState();
      expect(tabs[0].name).toBe('helper.go');
      // Renaming a tab shifts the runner because the file extension
      // is the only contract Lingua has between filename and runner.
      expect(tabs[0].language).toBe('go');
      // Dirty stays true even on a clean tab — the in-memory name has
      // diverged from disk (or from the tab's logical identity), so
      // the user needs to see a save indicator until they reconcile.
      expect(tabs[0].isDirty).toBe(true);
    });

    it('treats whitespace-only names as a no-op rather than nuking the filename', () => {
      const tab = createDefaultTab('javascript');
      useEditorStore.getState().addTab(tab);
      const originalName = tab.name;

      useEditorStore.getState().renameTab(tab.id, '   ');

      expect(useEditorStore.getState().tabs[0].name).toBe(originalName);
      expect(useEditorStore.getState().tabs[0].isDirty).toBe(false);
    });

    it('skips work when the trimmed new name matches the existing one', () => {
      const tab = createDefaultTab('javascript');
      useEditorStore.getState().addTab(tab);

      // Sanity check: addTab seeds isDirty=false; rename to the same
      // name should preserve that, not flip it.
      useEditorStore.getState().renameTab(tab.id, `  ${tab.name}  `);

      expect(useEditorStore.getState().tabs[0].isDirty).toBe(false);
      expect(useEditorStore.getState().tabs[0].name).toBe(tab.name);
    });

    it('renames notebook tabs by syncing the notebook title without marking the tab dirty', () => {
      const tabId = useEditorStore
        .getState()
        .addNotebookTab({ title: 'Notebook draft', language: 'python' });
      expect(tabId).toBeTruthy();

      useEditorStore.getState().renameTab(tabId!, '  Analysis.linguanb  ');

      const tab = useEditorStore.getState().tabs.find((item) => item.id === tabId);
      expect(tab).toMatchObject({
        name: 'Analysis.linguanb',
        language: 'python',
        kind: 'notebook',
        isDirty: false,
      });
      expect(useNotebookStore.getState().getNotebookForTab(tabId!)?.title).toBe(
        'Analysis'
      );
    });

    it('evicts dependency detections when rename changes the tab language', () => {
      const tab = createDefaultTab('javascript');
      useEditorStore.getState().addTab(tab);
      useDependencyDetectionStore.getState().setDetection(tab.id, {
        tabId: tab.id,
        language: 'javascript',
        detectionHash: 'h',
        dependencies: [
          { name: 'lodash', kind: 'import', status: 'detected' },
        ],
        classifiedAt: 1,
      });

      useEditorStore.getState().renameTab(tab.id, 'helper.go');

      expect(useDependencyDetectionStore.getState().byTab.has(tab.id)).toBe(
        false
      );
    });

    it('drops recipe binding and transient recipe state when rename leaves JavaScript', () => {
      const tab = {
        ...createDefaultTab('javascript'),
        recipeBindingId: 'js-sort-objects',
      };
      useEditorStore.getState().addTab(tab);
      useRecipeStore.getState().bindRecipeToTab(tab.id, 'js-sort-objects');
      useRecipeStore
        .getState()
        .setRunResults(tab.id, [{ assertionId: 'a', status: 'pass' }]);

      useEditorStore.getState().renameTab(tab.id, 'helper.py');

      expect(useEditorStore.getState().tabs[0].recipeBindingId).toBeUndefined();
      expect(useRecipeStore.getState().getBindingForTab(tab.id)).toBeUndefined();
      expect(useRecipeStore.getState().getRunResultsForTab(tab.id)).toHaveLength(0);
    });
  });

  describe('clearRecipeBinding', () => {
    it('clears the persisted tab binding and transient recipe state', () => {
      const tab = {
        ...createDefaultTab('javascript'),
        recipeBindingId: 'js-sort-objects',
      };
      useEditorStore.getState().addTab(tab);
      useRecipeStore.getState().bindRecipeToTab(tab.id, 'js-sort-objects');

      useEditorStore.getState().clearRecipeBinding(tab.id);

      expect(useEditorStore.getState().tabs[0].recipeBindingId).toBeUndefined();
      expect(useRecipeStore.getState().getBindingForTab(tab.id)).toBeUndefined();
    });
  });

  describe('closeOtherTabs / closeTabsToRight / closeAllTabs', () => {
    it('closes every tab except the supplied id when closeOtherTabs runs', async () => {
      const a = createDefaultTab('javascript');
      const b = createDefaultTab('python');
      const c = createDefaultTab('go');
      useEditorStore.getState().addTab(a);
      useEditorStore.getState().addTab(b);
      useEditorStore.getState().addTab(c);

      await useEditorStore.getState().closeOtherTabs(b.id);

      const { tabs } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0].id).toBe(b.id);
    });

    it('closes only the tabs to the right of the pivot when closeTabsToRight runs', async () => {
      const a = createDefaultTab('javascript');
      const b = createDefaultTab('python');
      const c = createDefaultTab('go');
      const d = createDefaultTab('rust');
      useEditorStore.getState().addTab(a);
      useEditorStore.getState().addTab(b);
      useEditorStore.getState().addTab(c);
      useEditorStore.getState().addTab(d);

      await useEditorStore.getState().closeTabsToRight(b.id);

      const { tabs } = useEditorStore.getState();
      expect(tabs).toHaveLength(2);
      expect(tabs.map((t) => t.id)).toEqual([a.id, b.id]);
    });

    it('clears the entire strip when closeAllTabs runs', async () => {
      const a = createDefaultTab('javascript');
      const b = createDefaultTab('python');
      useEditorStore.getState().addTab(a);
      useEditorStore.getState().addTab(b);

      await useEditorStore.getState().closeAllTabs();

      expect(useEditorStore.getState().tabs).toHaveLength(0);
    });

    it('routes dirty tabs through the existing closeTab dirty-check prompt', async () => {
      const a = createDefaultTab('javascript');
      const b = createDefaultTab('python');
      useEditorStore.getState().addTab(a);
      useEditorStore.getState().addTab(b);
      useEditorStore.getState().updateContent(b.id, 'unsaved work');

      // First click of the prompt: Discard. The flow lands without
      // saving and removes the tab — same contract as a single
      // closeTab call. Use a vi.fn that resolves to 1 (Discard) so
      // we exercise the dirty-check branch end-to-end.
      const confirmCloseTab = window.lingua.confirmCloseTab as ReturnType<typeof vi.fn>;
      confirmCloseTab.mockResolvedValue(1);

      await useEditorStore.getState().closeAllTabs();

      expect(confirmCloseTab).toHaveBeenCalledTimes(1);
      expect(useEditorStore.getState().tabs).toHaveLength(0);
    });

    it('stops closeAllTabs after the first dirty-tab cancel', async () => {
      const a = createDefaultTab('javascript');
      const b = createDefaultTab('python');
      const c = createDefaultTab('go');
      useEditorStore.getState().addTab(a);
      useEditorStore.getState().addTab(b);
      useEditorStore.getState().addTab(c);
      useEditorStore.getState().updateContent(b.id, 'unsaved work');

      const confirmCloseTab = window.lingua.confirmCloseTab as ReturnType<typeof vi.fn>;
      confirmCloseTab.mockResolvedValue(2);

      await useEditorStore.getState().closeAllTabs();

      expect(confirmCloseTab).toHaveBeenCalledTimes(1);
      expect(useEditorStore.getState().tabs.map((tab) => tab.id)).toEqual([b.id, c.id]);
    });

    it('stops closeTabsToRight after a dirty-tab cancel', async () => {
      const a = createDefaultTab('javascript');
      const b = createDefaultTab('python');
      const c = createDefaultTab('go');
      const d = createDefaultTab('rust');
      useEditorStore.getState().addTab(a);
      useEditorStore.getState().addTab(b);
      useEditorStore.getState().addTab(c);
      useEditorStore.getState().addTab(d);
      useEditorStore.getState().updateContent(c.id, 'unsaved work');

      const confirmCloseTab = window.lingua.confirmCloseTab as ReturnType<typeof vi.fn>;
      confirmCloseTab.mockResolvedValue(2);

      await useEditorStore.getState().closeTabsToRight(b.id);

      expect(confirmCloseTab).toHaveBeenCalledTimes(1);
      expect(useEditorStore.getState().tabs.map((tab) => tab.id)).toEqual([
        a.id,
        b.id,
        c.id,
        d.id,
      ]);
    });

    it('stops closeOtherTabs after a dirty-tab cancel', async () => {
      const a = createDefaultTab('javascript');
      const b = createDefaultTab('python');
      const c = createDefaultTab('go');
      const d = createDefaultTab('rust');
      useEditorStore.getState().addTab(a);
      useEditorStore.getState().addTab(b);
      useEditorStore.getState().addTab(c);
      useEditorStore.getState().addTab(d);
      useEditorStore.getState().updateContent(c.id, 'unsaved work');

      const confirmCloseTab = window.lingua.confirmCloseTab as ReturnType<typeof vi.fn>;
      confirmCloseTab.mockResolvedValue(2);

      await useEditorStore.getState().closeOtherTabs(b.id);

      expect(confirmCloseTab).toHaveBeenCalledTimes(1);
      expect(useEditorStore.getState().tabs.map((tab) => tab.id)).toEqual([
        b.id,
        c.id,
        d.id,
      ]);
    });
  });

  describe('requestReveal / clearPendingReveal', () => {
    it('queues a reveal with sane defaults and lets callers clear it', () => {
      useEditorStore.getState().requestReveal({
        filePath: '/tmp/foo.ts',
        line: 12,
        column: 4,
      });

      expect(useEditorStore.getState().pendingReveal).toEqual({
        filePath: '/tmp/foo.ts',
        line: 12,
        column: 4,
      });

      useEditorStore.getState().clearPendingReveal();
      expect(useEditorStore.getState().pendingReveal).toBeNull();
    });

    it('clamps line/column to Monaco-safe 1-indexed positions', () => {
      useEditorStore.getState().requestReveal({
        filePath: '/tmp/bar.ts',
        line: 0,
        column: -5,
      });

      expect(useEditorStore.getState().pendingReveal).toEqual({
        filePath: '/tmp/bar.ts',
        line: 1,
        column: 1,
      });
    });

    it('keeps column undefined when no column is supplied', () => {
      useEditorStore.getState().requestReveal({
        filePath: '/tmp/baz.ts',
        line: 3,
      });

      expect(useEditorStore.getState().pendingReveal).toEqual({
        filePath: '/tmp/baz.ts',
        line: 3,
        column: undefined,
      });
    });

    it('overwrites older pending reveals so the latest request wins', () => {
      useEditorStore.getState().requestReveal({
        filePath: '/tmp/first.ts',
        line: 1,
      });
      useEditorStore.getState().requestReveal({
        filePath: '/tmp/second.ts',
        line: 20,
        column: 5,
      });

      expect(useEditorStore.getState().pendingReveal).toEqual({
        filePath: '/tmp/second.ts',
        line: 20,
        column: 5,
      });
    });
  });

  describe('RL-060 tab budget enforcement', () => {
    it('blocks notebook tabs on Free even when the tab budget is empty', async () => {
      const { useLicenseStore } = await import('@/stores/licenseStore');
      const { useUIStore } = await import('@/stores/uiStore');
      useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
      useUIStore.setState({ statusNotice: null });

      const tabId = useEditorStore.getState().addNotebookTab();

      expect(tabId).toBeNull();
      expect(useEditorStore.getState().tabs).toHaveLength(0);
      expect(useNotebookStore.getState().notebooks).toEqual({});
      expect(useUIStore.getState().statusNotice).toMatchObject({
        messageKey: 'upsell.freeCeilingReached',
      });
    });

    it('blocks addTab past the Free ceiling and pushes an upsell notice', async () => {
      const { useLicenseStore } = await import('@/stores/licenseStore');
      const { useUIStore } = await import('@/stores/uiStore');
      useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
      useUIStore.setState({ statusNotice: null });

      const first = createDefaultTab('javascript');
      useEditorStore.getState().addTab(first);
      expect(useEditorStore.getState().tabs).toHaveLength(1);

      useEditorStore.getState().addTab(createDefaultTab('python'));
      expect(useEditorStore.getState().tabs).toHaveLength(1);
      expect(useUIStore.getState().statusNotice?.messageKey).toBe('upsell.freeCeilingReached');
    });

    it('waves paid tiers through the ceiling so Pro users get unlimited tabs', async () => {
      const { useLicenseStore } = await import('@/stores/licenseStore');
      useLicenseStore.setState({
        token: 'proof.sig',
        status: {
          kind: 'active',
          verification: {
            ok: true,
            state: 'active',
            supportWindowEndsAt: Date.now() + 86_400_000,
            payload: {
              productId: 'lingua-desktop',
              tier: 'pro',
              issuedTo: 'user@example.com',
              issuedAt: new Date().toISOString(),
              supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
              entitlements: [],
            },
          },
        },
        lastVerifiedAt: Date.now(),
      });

      for (let i = 0; i < 5; i += 1) {
        useEditorStore.getState().addTab(createDefaultTab('javascript'));
      }
      expect(useEditorStore.getState().tabs).toHaveLength(5);
    });

    it('blocks openFile past the Free ceiling and skips disk reads', async () => {
      const { useLicenseStore } = await import('@/stores/licenseStore');
      const { useUIStore } = await import('@/stores/uiStore');
      useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
      useUIStore.setState({ statusNotice: null });

      useEditorStore.getState().addTab(createDefaultTab('javascript'));
      (window.lingua.fs.read as ReturnType<typeof vi.fn>).mockResolvedValue('print("hi")');

      await useEditorStore
        .getState()
        .openFile('root-blocked', 'blocked.py', 'blocked.py', 'python', '/tmp/blocked.py');

      expect(window.lingua.fs.read).not.toHaveBeenCalled();
      expect(useEditorStore.getState().tabs).toHaveLength(1);
      expect(useUIStore.getState().statusNotice?.messageKey).toBe('upsell.freeCeilingReached');
    });

    it('RL-065 — emits feature.blocked telemetry when addTab hits the Free ceiling', async () => {
      const { useLicenseStore } = await import('@/stores/licenseStore');
      useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
      mockTrackEvent.mockClear();

      useEditorStore.getState().addTab(createDefaultTab('javascript'));
      // First tab fits the budget — no telemetry emitted yet.
      expect(mockTrackEvent).not.toHaveBeenCalled();

      useEditorStore.getState().addTab(createDefaultTab('python'));
      // Second tab on Free hits the gate; telemetry fires.
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'feature.blocked',
        expect.objectContaining({ entitlement: 'tabs', tier: 'free' })
      );
    });

    it('RL-065 — emits feature.blocked telemetry when openFile hits the Free ceiling', async () => {
      const { useLicenseStore } = await import('@/stores/licenseStore');
      useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
      mockTrackEvent.mockClear();

      useEditorStore.getState().addTab(createDefaultTab('javascript'));
      mockTrackEvent.mockClear();

      await useEditorStore
        .getState()
        .openFile('root-blocked', 'blocked.py', 'blocked.py', 'python', '/tmp/blocked.py');

      expect(mockTrackEvent).toHaveBeenCalledWith(
        'feature.blocked',
        expect.objectContaining({ entitlement: 'tabs', tier: 'free' })
      );
    });

    it('RL-065 — does NOT emit feature.blocked when a Pro user opens additional tabs', async () => {
      const { useLicenseStore } = await import('@/stores/licenseStore');
      useLicenseStore.setState({
        token: 'pro.token',
        status: {
          kind: 'active',
          verification: {
            ok: true,
            state: 'active',
            supportWindowEndsAt: Date.now() + 86_400_000,
            payload: {
              productId: 'lingua-desktop',
              tier: 'pro',
              issuedTo: 'pro@example.com',
              issuedAt: new Date().toISOString(),
              supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
              entitlements: [],
            },
          },
        },
        lastVerifiedAt: Date.now(),
      });
      mockTrackEvent.mockClear();

      for (let i = 0; i < 4; i += 1) {
        useEditorStore.getState().addTab(createDefaultTab('javascript'));
      }

      const blockedCalls = mockTrackEvent.mock.calls.filter(
        ([event]) => event === 'feature.blocked'
      );
      expect(blockedCalls).toHaveLength(0);
    });
  });

  // SQL/HTTP MODEL rework — SQL and HTTP are full-screen COLLECTION
  // workspaces: at most ONE SQL tab + ONE HTTP tab, each on a stable
  // constant id, exempt from the Free tab budget, never renamed /
  // duplicated / saved through the document tab gestures.
  describe('SQL / HTTP workspace tabs', () => {
    const freeTier = {
      token: null,
      status: { kind: 'free' as const },
      lastVerifiedAt: null,
    };

    it('addSqlTab creates the single SQL workspace tab on the stable id', () => {
      const id = useEditorStore.getState().addSqlTab();
      expect(id).toBe(SQL_WORKSPACE_TAB_ID);
      const { tabs, activeTabId } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toMatchObject({
        id: SQL_WORKSPACE_TAB_ID,
        kind: 'sql',
        language: 'sql',
      });
      expect(activeTabId).toBe(SQL_WORKSPACE_TAB_ID);
    });

    it('addHttpTab creates the single HTTP workspace tab on the stable id', () => {
      const id = useEditorStore.getState().addHttpTab();
      expect(id).toBe(HTTP_WORKSPACE_TAB_ID);
      const { tabs, activeTabId } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toMatchObject({
        id: HTTP_WORKSPACE_TAB_ID,
        kind: 'http',
        language: 'http',
      });
      expect(activeTabId).toBe(HTTP_WORKSPACE_TAB_ID);
    });

    it('addSqlTab focuses the existing workspace tab instead of minting a duplicate', () => {
      const first = useEditorStore.getState().addSqlTab();
      // Move focus elsewhere so the focus-or-create path is observable.
      useEditorStore.getState().addTab(createDefaultTab('javascript'));
      expect(useEditorStore.getState().activeTabId).not.toBe(first);

      const second = useEditorStore.getState().addSqlTab();

      expect(second).toBe(first);
      const sqlTabs = useEditorStore
        .getState()
        .tabs.filter((t) => t.kind === 'sql');
      expect(sqlTabs).toHaveLength(1);
      expect(useEditorStore.getState().activeTabId).toBe(SQL_WORKSPACE_TAB_ID);
    });

    it('addHttpTab focuses the existing workspace tab instead of minting a duplicate', () => {
      const first = useEditorStore.getState().addHttpTab();
      useEditorStore.getState().addTab(createDefaultTab('javascript'));
      const second = useEditorStore.getState().addHttpTab();
      expect(second).toBe(first);
      expect(
        useEditorStore.getState().tabs.filter((t) => t.kind === 'http')
      ).toHaveLength(1);
    });

    it('exempts workspace tabs from the Free tab budget so a Free user still gets a code tab', async () => {
      const { useLicenseStore } = await import('@/stores/licenseStore');
      const { useUIStore } = await import('@/stores/uiStore');
      useLicenseStore.setState(freeTier);
      useUIStore.setState({ statusNotice: null });

      // Open both workspaces — exempt, so always succeed.
      expect(useEditorStore.getState().addSqlTab()).toBe(SQL_WORKSPACE_TAB_ID);
      expect(useEditorStore.getState().addHttpTab()).toBe(HTTP_WORKSPACE_TAB_ID);
      expect(useEditorStore.getState().tabs).toHaveLength(2);

      // The single Free code tab must still fit — the two workspace
      // tabs do NOT crowd it out of the budget.
      useEditorStore.getState().addTab(createDefaultTab('javascript'));
      expect(useEditorStore.getState().tabs).toHaveLength(3);
      expect(useUIStore.getState().statusNotice).toBeNull();

      // A SECOND code tab is over the Free ceiling and is refused, even
      // though workspace tabs are present.
      useEditorStore.getState().addTab(createDefaultTab('python'));
      expect(
        useEditorStore.getState().tabs.filter((t) => !t.kind)
      ).toHaveLength(1);
      expect(useUIStore.getState().statusNotice?.messageKey).toBe(
        'upsell.freeCeilingReached'
      );
    });

    it('addSqlTab succeeds on Free even though sql is not in the Free language allowlist', async () => {
      const { useLicenseStore } = await import('@/stores/licenseStore');
      const { useUIStore } = await import('@/stores/uiStore');
      useLicenseStore.setState(freeTier);
      useUIStore.setState({ statusNotice: null });

      const id = useEditorStore.getState().addSqlTab();

      // Bypasses the isLanguageAllowed gate that 'sql' would otherwise
      // trip in the addTab path — no upsell notice, tab created.
      expect(id).toBe(SQL_WORKSPACE_TAB_ID);
      expect(useUIStore.getState().statusNotice).toBeNull();
    });

    it('duplicateActiveTab is a no-op on a workspace tab (no colliding stable id)', () => {
      useEditorStore.getState().addSqlTab();
      useEditorStore.getState().duplicateActiveTab();
      expect(
        useEditorStore.getState().tabs.filter((t) => t.kind === 'sql')
      ).toHaveLength(1);
      expect(useEditorStore.getState().tabs).toHaveLength(1);
    });

    it('renameTab refuses to rename a workspace tab so the label never drifts', () => {
      useEditorStore.getState().addHttpTab();
      useEditorStore.getState().renameTab(HTTP_WORKSPACE_TAB_ID, 'Custom name');
      const tab = useEditorStore
        .getState()
        .tabs.find((t) => t.id === HTTP_WORKSPACE_TAB_ID);
      expect(tab?.name).toBe('HTTP');
    });

    it('saveTabById no-ops on a workspace tab without opening a file dialog', async () => {
      useEditorStore.getState().addSqlTab();
      const saved = await useEditorStore
        .getState()
        .saveTabById(SQL_WORKSPACE_TAB_ID);
      expect(saved).toBe(false);
      // No save dialog gesture for a workspace tab.
      expect(window.lingua.fs.saveDialog).not.toHaveBeenCalled();
      expect(window.lingua.fs.write).not.toHaveBeenCalled();
    });

    it('removeTab drops only the workspace tab, leaving sibling tabs intact', () => {
      useEditorStore.getState().addTab(createDefaultTab('javascript'));
      useEditorStore.getState().addSqlTab();
      expect(useEditorStore.getState().tabs).toHaveLength(2);

      useEditorStore.getState().removeTab(SQL_WORKSPACE_TAB_ID);

      const { tabs } = useEditorStore.getState();
      expect(tabs).toHaveLength(1);
      expect(tabs.some((t) => t.kind === 'sql')).toBe(false);
    });
  });
});
