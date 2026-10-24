/** Whether a SQL / HTTP workspace has an open editor for toolbar Run to act on. */

import { create } from 'zustand';

export type RunnableWorkspace = 'sql' | 'http';

interface WorkspaceRunReadyState {
  ready: Readonly<Record<RunnableWorkspace, boolean>>;
  setReady: (kind: RunnableWorkspace, ready: boolean) => void;
}

export const useWorkspaceRunReadyStore = create<WorkspaceRunReadyState>(set => ({
  ready: { sql: false, http: false },
  setReady: (kind, ready) => set(state => ({ ready: { ...state.ready, [kind]: ready } })),
}));

/** The SQL / HTTP workspace kind when that tab has nothing to run, else null. */
export function useEmptyWorkspace(kind: string | undefined): RunnableWorkspace | null {
  return useWorkspaceRunReadyStore(state =>
    (kind === 'sql' || kind === 'http') && !state.ready[kind] ? kind : null
  );
}
