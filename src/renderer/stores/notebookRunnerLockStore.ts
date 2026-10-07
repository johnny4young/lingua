/**
 * Which shared runner a notebook cell currently holds.
 *
 * Notebook JS/TS and Python cells execute on the same language-keyed runners
 * as editor tabs, and those runners terminate any run in flight when a new one
 * starts. Auto-run, manual runs and other notebooks consult this claim so they
 * never preempt a cell, and notebook Stop only reaches a runner it owns.
 * In-memory only: never persisted or serialized.
 */
import { create } from 'zustand';
import { languageHasRuntimeModes, type RuntimeMode } from '../../shared/runtimeModes';

/** TypeScript cells run on the JavaScript worker after type stripping. */
export type NotebookRunnerKey = 'javascript' | 'python';

interface NotebookRunnerClaim {
  readonly tabId: string;
}

interface NotebookRunnerLockState {
  owners: Partial<Record<NotebookRunnerKey, NotebookRunnerClaim>>;
  /** Bumped on every claim so a run it preempted can tell after the release. */
  claimEpochs: Partial<Record<NotebookRunnerKey, number>>;
}

export const useNotebookRunnerLockStore = create<NotebookRunnerLockState>(() => ({
  owners: {},
  claimEpochs: {},
}));

export function notebookCellRunnerKey(language: string): NotebookRunnerKey | null {
  if (language === 'javascript' || language === 'typescript') return 'javascript';
  if (language === 'python') return 'python';
  return null;
}

/** The notebook-shared runner an editor run would execute on, if any. */
export function editorRunnerKey(
  language: string,
  runtimeMode: RuntimeMode | undefined,
  debug = false
): NotebookRunnerKey | null {
  if (language !== 'javascript' && language !== 'python') return null;
  // Explicit JS runtime modes and Python Debug use their own runners.
  if (runtimeMode && runtimeMode !== 'worker' && languageHasRuntimeModes(language)) return null;
  if (debug && language === 'python') return null;
  return language;
}

export function notebookRunnerOwner(key: NotebookRunnerKey | null): string | null {
  if (!key) return null;
  return useNotebookRunnerLockStore.getState().owners[key]?.tabId ?? null;
}

export function notebookRunnerClaimEpoch(key: NotebookRunnerKey | null): number {
  if (!key) return 0;
  return useNotebookRunnerLockStore.getState().claimEpochs[key] ?? 0;
}

/** Returns an idempotent release, or null when another notebook holds the runner. */
export function claimNotebookRunner(key: NotebookRunnerKey, tabId: string): (() => void) | null {
  const state = useNotebookRunnerLockStore.getState();
  if (state.owners[key]) return null;
  const claim: NotebookRunnerClaim = { tabId };
  useNotebookRunnerLockStore.setState({
    owners: { ...state.owners, [key]: claim },
    claimEpochs: { ...state.claimEpochs, [key]: (state.claimEpochs[key] ?? 0) + 1 },
  });
  return () => {
    const { owners } = useNotebookRunnerLockStore.getState();
    if (owners[key] !== claim) return;
    const next = { ...owners };
    delete next[key];
    useNotebookRunnerLockStore.setState({ owners: next });
  };
}

export function resetNotebookRunnerLocksForTests(): void {
  useNotebookRunnerLockStore.setState({ owners: {}, claimEpochs: {} });
}
