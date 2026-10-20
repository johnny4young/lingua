import { beforeEach, describe, expect, it } from 'vitest';
import { toggleExplorerOrToolList } from '../../src/renderer/utils/explorerToggle';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { useUtilityWorkspaceStore } from '../../src/renderer/stores/utilityWorkspaceStore';

function activate(kind?: 'utilities') {
  useEditorStore.setState({
    tabs: [{ id: 't', name: 'a', language: 'javascript', content: '', isDirty: false, ...(kind ? { kind } : {}) }] as never,
    activeTabId: 't',
  });
}

beforeEach(() => {
  useUIStore.setState({ sidebarVisible: false });
  useUtilityWorkspaceStore.setState({ toolListOpen: false });
});

describe('Cmd/Ctrl+B', () => {
  it('toggles the tool list on a Utilities tab and leaves the explorer alone', () => {
    activate('utilities');
    toggleExplorerOrToolList();
    expect(useUtilityWorkspaceStore.getState().toolListOpen).toBe(true);
    expect(useUIStore.getState().sidebarVisible).toBe(false);
  });

  it('toggles the project explorer on any other tab', () => {
    activate();
    toggleExplorerOrToolList();
    expect(useUIStore.getState().sidebarVisible).toBe(true);
    expect(useUtilityWorkspaceStore.getState().toolListOpen).toBe(false);
  });
});
