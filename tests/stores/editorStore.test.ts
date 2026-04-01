import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, createDefaultTab } from '@/stores/editorStore';

describe('editorStore', () => {
  beforeEach(() => {
    // Reset store state
    useEditorStore.setState({
      tabs: [],
      activeTabId: null,
    });
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
});
