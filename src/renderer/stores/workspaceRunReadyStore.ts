/** Whether a SQL / HTTP workspace has an open editor for toolbar Run to act on. */

import { create } from 'zustand';

export type RunnableWorkspace = 'sql' | 'http';

interface WorkspaceRunReadyState {
  ready: Readonly<Record<RunnableWorkspace, boolean>>;
  /** Open, but what it holds cannot run yet (an HTTP request without a valid URL). */
  blocked: Readonly<Record<RunnableWorkspace, boolean>>;
  setReady: (kind: RunnableWorkspace, ready: boolean) => void;
  setBlocked: (kind: RunnableWorkspace, blocked: boolean) => void;
}

export const useWorkspaceRunReadyStore = create<WorkspaceRunReadyState>(set => ({
  ready: { sql: false, http: false },
  blocked: { sql: false, http: false },
  setReady: (kind, ready) => set(state => ({ ready: { ...state.ready, [kind]: ready } })),
  setBlocked: (kind, blocked) => set(state => ({ blocked: { ...state.blocked, [kind]: blocked } })),
}));

/** The SQL / HTTP workspace kind when that tab has nothing to run, else null. */
export function useEmptyWorkspace(kind: string | undefined): RunnableWorkspace | null {
  return useWorkspaceRunReadyStore(state =>
    (kind === 'sql' || kind === 'http') && !state.ready[kind] ? kind : null
  );
}

/** True when the HTTP tab is open on a request whose URL cannot be sent yet. */
export function useBlockedHttpWorkspace(kind: string | undefined): boolean {
  return useWorkspaceRunReadyStore(state => kind === 'http' && state.ready.http && state.blocked.http);
}
