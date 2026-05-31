/**
 * MOV.02 (FASE 3) — full-screen mount wrapper for the SQL workspace.
 *
 * Mirror of `<HttpWorkspaceView>`. SQL/HTTP MODEL rework — the SQL
 * surface is a single COLLECTION tab, not one tab per query. `tabId` is
 * NOT a query binding: `<SqlWorkspacePanel>` accepts it only for
 * call-site compatibility and ignores it for selection. The editor +
 * result columns bind to the store's `activeQueryId`, driven entirely
 * by the in-panel rail. This wrapper only supplies the full-height
 * container AppLayout's branch mounts it into (the panel's own
 * `<Group className="h-full">` resolves against `h-full min-h-0`).
 */

import { SqlWorkspacePanel } from './SqlWorkspacePanel';

export function SqlWorkspaceView({ tabId }: { tabId: string }) {
  return (
    <div className="h-full min-h-0">
      <SqlWorkspacePanel tabId={tabId} />
    </div>
  );
}
