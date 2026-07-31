/**
 * SQL/HTTP MODEL rework — workspace-tab entry-point bridge.
 *
 * SQL and HTTP are full-screen COLLECTION workspaces: ONE TablePlus-style
 * SQL workspace tab + ONE Insomnia/Postman-style HTTP workspace tab, each
 * carrying a stable constant id (`SQL_WORKSPACE_TAB_ID` /
 * `HTTP_WORKSPACE_TAB_ID`). The collection of queries / requests lives in
 * `useWorkspaceSqlStore.queries` / `useWorkspaceToolStore.requests` and is
 * navigated by the in-panel RAIL (`activeQueryId` / `activeRequestId`). The
 * tab no longer maps to a single query/request — there is at most one tab
 * per kind, regardless of how many queries/requests the collection holds.
 *
 * Every legacy entry point (Mod+Alt+S, Mod+Shift+K, the command-palette
 * `Open … workspace` actions, the cURL / Postman / Bruno importers, and
 * the capsule importer) routes through the two helpers below.
 *
 * The helpers only open or focus the stable editor tabs. Importers write to
 * their activation-scoped workspace store first; its create mutation selects
 * the new entry atomically, then this bridge reveals the corresponding tab.
 * Keeping collection state out of this always-available module prevents HTTP
 * and SQL persistence/parsing code from joining the startup graph.
 */

import { useEditorStore } from '../stores/editorStore';
import type { DeveloperUtilityId } from '../data/developerUtilityCatalog';

/** Open or focus the single HTTP workspace tab. */
export function openHttpWorkspaceTab(): string | null {
  return useEditorStore.getState().addHttpTab();
}

/** Open or focus the single SQL workspace tab. */
export function openSqlWorkspaceTab(): string | null {
  return useEditorStore.getState().addSqlTab();
}

/**
 * Open or focus the single Developer Utilities workspace tab. With
 * `utilityId`, selects that tool before focusing the tab (used by
 * utility-specific shortcuts and command-palette actions).
 */
export function openUtilitiesWorkspaceTab(utilityId?: DeveloperUtilityId): string | null {
  return useEditorStore.getState().addUtilitiesTab(utilityId);
}
