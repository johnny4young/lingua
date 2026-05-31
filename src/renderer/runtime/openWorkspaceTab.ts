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
 * Two call shapes:
 *
 *  - No argument → "open or focus" for the keyboard / palette surfaces.
 *    Focuses the single workspace tab if open, else creates it. A full-
 *    screen tab has no "hide" state; the user closes it via the tab strip
 *    (and the collection survives in its own store).
 *
 *  - `{ adoptEntryId }` → "select an existing store entry" for the importer
 *    flows. The importer has ALREADY written the `HttpRequestV1` /
 *    `SqlQueryV1` into the workspace store (via `createRequest(s)` /
 *    `createQuery`). We simply open-or-focus the single workspace tab and
 *    mark the adopted entry active so the rail + editor land on it. No
 *    per-query/request tab is minted, and no fields are copied — the store
 *    already owns the entry.
 */

import { useEditorStore } from '../stores/editorStore';
import { useWorkspaceToolStore } from '../stores/workspaceToolStore';
import { useWorkspaceSqlStore } from '../stores/workspaceSqlStore';

interface OpenWorkspaceTabOptions {
  /**
   * When set, the workspace-store entry with this id is made the active
   * selection after the single workspace tab is opened/focused. Used by
   * the importer flows that pre-create the request/query.
   */
  adoptEntryId?: string;
}

/**
 * Open or focus the single HTTP workspace tab. With `adoptEntryId`, marks
 * the already-created request active so the rail selects it.
 */
export function openHttpWorkspaceTab(
  options: OpenWorkspaceTabOptions = {}
): string | null {
  const tabId = useEditorStore.getState().addHttpTab();
  if (tabId === null) return null;
  if (options.adoptEntryId) {
    useWorkspaceToolStore.getState().setActiveRequest(options.adoptEntryId);
  }
  return tabId;
}

/**
 * Open or focus the single SQL workspace tab. With `adoptEntryId`, marks
 * the already-created query active so the rail selects it.
 */
export function openSqlWorkspaceTab(
  options: OpenWorkspaceTabOptions = {}
): string | null {
  const tabId = useEditorStore.getState().addSqlTab();
  if (tabId === null) return null;
  if (options.adoptEntryId) {
    useWorkspaceSqlStore.getState().setActiveQuery(options.adoptEntryId);
  }
  return tabId;
}
