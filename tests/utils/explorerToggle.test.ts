import { beforeEach, describe, expect, it } from 'vitest';
import { toggleExplorerOrToolList } from '../../src/renderer/utils/explorerToggle';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { useUtilityWorkspaceStore } from '../../src/renderer/stores/utilityWorkspaceStore';
import { useWorkspaceSqlStore } from '../../src/renderer/stores/workspaceSqlStore';

function activate(kind?: 'utilities' | 'sql') {
  useEditorStore.setState({
    tabs: [{ id: 't', name: 'a', language: 'javascript', content: '', isDirty: false, ...(kind ? { kind } : {}) }] as never,
    activeTabId: 't',
  });
}

beforeEach(() => {
  useUIStore.setState({ sidebarVisible: false });
  useUtilityWorkspaceStore.setState({ toolListOpen: false });
  useWorkspaceSqlStore.setState({ explorerFolded: false });
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

  it('folds the SQL Explorer on the SQL tab and leaves the project explorer alone', async () => {
    activate('sql');
    await toggleExplorerOrToolList();
    expect(useWorkspaceSqlStore.getState().explorerFolded).toBe(true);
    expect(useUIStore.getState().sidebarVisible).toBe(false);
  });
});
