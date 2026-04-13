import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSessionStore } from '@/stores/sessionStore';
import { useEditorStore } from '@/stores/editorStore';

describe('sessionStore', () => {
  const initialSessionState = useSessionStore.getState();
  const initialEditorState = useEditorStore.getState();

  beforeEach(() => {
    useSessionStore.setState(initialSessionState, true);
    useEditorStore.setState({ tabs: [], activeTabId: null });
    localStorage.clear();

    Object.defineProperty(globalThis, 'window', {
      value: {
        lingua: {
          fs: {
            read: vi.fn().mockResolvedValue('restored content'),
          },
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    useSessionStore.setState(initialSessionState, true);
    useEditorStore.setState(initialEditorState, true);
    localStorage.clear();
  });

  it('should start with empty saved tabs', () => {
    const { savedTabs } = useSessionStore.getState();
    expect(savedTabs).toHaveLength(0);
  });

  it('should save the current editor session', () => {
    // Set up editor with tabs
    useEditorStore.setState({
      tabs: [
        {
          id: 'tab-1',
          name: 'hello.js',
          language: 'javascript',
          content: 'console.log("hi")',
          isDirty: false,
          filePath: '/path/hello.js',
        },
        {
          id: 'tab-2',
          name: 'untitled.ts',
          language: 'typescript',
          content: 'const x = 42;',
          isDirty: true,
        },
      ],
      activeTabId: 'tab-1',
    });

    useSessionStore.getState().saveSession();

    const { savedTabs, savedActiveIndex } = useSessionStore.getState();
    expect(savedTabs).toHaveLength(2);
    expect(savedActiveIndex).toBe(0);

    // Disk-backed tab stores empty content (re-reads on restore)
    expect(savedTabs[0].content).toBe('');
    expect(savedTabs[0].filePath).toBe('/path/hello.js');

    // In-memory tab stores content
    expect(savedTabs[1].content).toBe('const x = 42;');
    expect(savedTabs[1].filePath).toBeUndefined();
  });

  it('should restore tabs from saved session', async () => {
    // Pre-populate saved session
    useSessionStore.setState({
      savedTabs: [
        {
          name: 'restored.js',
          language: 'javascript',
          content: '',
          filePath: '/path/restored.js',
        },
        {
          name: 'scratch.py',
          language: 'python',
          content: 'print("hello")',
        },
      ],
      savedActiveIndex: 1,
    });

    await useSessionStore.getState().restoreSession();

    const { tabs, activeTabId } = useEditorStore.getState();
    expect(tabs).toHaveLength(2);

    // Disk-backed tab should have been read from disk
    expect(tabs[0].name).toBe('restored.js');
    expect(tabs[0].content).toBe('restored content');
    expect(tabs[0].filePath).toBe('/path/restored.js');

    // In-memory tab uses saved content
    expect(tabs[1].name).toBe('scratch.py');
    expect(tabs[1].content).toBe('print("hello")');

    // Active tab should be the second one (index 1)
    expect(activeTabId).toBe(tabs[1].id);
  });

  it('should handle missing files gracefully during restore', async () => {
    (window.lingua.fs.read as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ENOENT')
    );

    useSessionStore.setState({
      savedTabs: [
        {
          name: 'gone.rs',
          language: 'rust',
          content: '',
          filePath: '/deleted/gone.rs',
        },
      ],
      savedActiveIndex: 0,
    });

    await useSessionStore.getState().restoreSession();

    const { tabs } = useEditorStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].content).toContain('File not found');
  });

  it('should not restore when there are no saved tabs', async () => {
    await useSessionStore.getState().restoreSession();
    expect(useEditorStore.getState().tabs).toHaveLength(0);
  });
});
