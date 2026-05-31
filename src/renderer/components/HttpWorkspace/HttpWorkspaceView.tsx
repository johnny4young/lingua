/**
 * MOV.02 (FASE 3) — full-screen mount wrapper for the HTTP workspace.
 *
 * Thin pass-through: it is the `React.lazy` import target in AppLayout
 * (keeping the HTTP/fetch chunk out of the initial bundle) and forwards
 * the workspace `tabId` to `<HttpWorkspacePanel>`.
 *
 * SQL/HTTP MODEL rework — the HTTP surface is a single COLLECTION tab,
 * not one tab per request. `tabId` is NOT a request binding: the panel
 * accepts it only for call-site compatibility and ignores it for
 * selection. The editor + response columns bind to the store's
 * `activeRequestId`, driven entirely by the in-panel rail. AppLayout's
 * branch already supplies the `h-full min-h-0` container that gives the
 * panel its height; the panel's own `<Group className="h-full">`
 * resolves against it.
 */

import { HttpWorkspacePanel } from './HttpWorkspacePanel';

export function HttpWorkspaceView({ tabId }: { tabId: string }) {
  return <HttpWorkspacePanel tabId={tabId} />;
}
