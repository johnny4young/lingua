import { useEffect } from 'react';
import { useCommandListener } from './useCommandListener';
import { useWorkspaceRunReadyStore, type RunnableWorkspace } from '../stores/workspaceRunReadyStore';

/** Lets toolbar Run and Mod+Enter reach this editor, and enables Run while it is mounted. */
export function useWorkspaceRunTarget(kind: RunnableWorkspace, run: () => void): void {
  useCommandListener('workspace.run', payload => {
    if (payload.kind === kind) run();
  });
  useEffect(() => {
    const { setReady } = useWorkspaceRunReadyStore.getState();
    setReady(kind, true);
    return () => setReady(kind, false);
  }, [kind]);
}
