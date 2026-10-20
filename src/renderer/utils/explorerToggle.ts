import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import { useUtilityWorkspaceStore } from '../stores/utilityWorkspaceStore';

/** Cmd/Ctrl+B: the tool list on a Utilities tab, the project explorer everywhere else. */
export function toggleExplorerOrToolList(): void {
  if (getActiveTab(useEditorStore.getState())?.kind === 'utilities') {
    useUtilityWorkspaceStore.getState().toggleToolList();
    return;
  }
  useUIStore.getState().toggleSidebar();
}
