import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import { useUtilityWorkspaceStore } from '../stores/utilityWorkspaceStore';

/** Cmd/Ctrl+B: the tool list on Utilities, the SQL Explorer on SQL, the project explorer elsewhere. */
export function toggleExplorerOrToolList(): Promise<void> | void {
  const kind = getActiveTab(useEditorStore.getState())?.kind;
  if (kind === 'utilities') {
    useUtilityWorkspaceStore.getState().toggleToolList();
    return;
  }
  if (kind === 'sql') {
    // The SQL store stays out of the initial bundle; an open SQL tab has already loaded it.
    return import('../stores/workspaceSqlStore').then(({ useWorkspaceSqlStore }) =>
      useWorkspaceSqlStore.getState().toggleExplorerFolded()
    );
  }
  useUIStore.getState().toggleSidebar();
}
