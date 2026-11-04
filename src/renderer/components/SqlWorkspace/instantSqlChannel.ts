import { useState } from 'react';
import type { InstantPreviewPlan } from '../../../shared/sqlCtePreview';
import { useSettingsStore } from '../../stores/settingsStore';

export interface InstantSqlDraft {
  queryId: string;
  text: string;
  plan: InstantPreviewPlan | null;
}

export interface InstantSqlSnapshot {
  draft: InstantSqlDraft | null;
  /** The draft as it was at the last Run; the preview hides until the text or target moves on. */
  ran: InstantSqlDraft | null;
  /** A breadcrumb asked the editor to move its cursor here. */
  jump: { offset: number; nonce: number } | null;
}

/**
 * Carries the editor's draft to the preview without re-rendering the panel
 * on every keystroke.
 */
export interface InstantSqlChannel {
  snapshot: () => InstantSqlSnapshot;
  subscribe: (listener: () => void) => () => void;
  publish: (draft: InstantSqlDraft) => void;
  /** Records what a Run started from; the last published draft when omitted. */
  markRun: (ran?: InstantSqlDraft) => void;
  jumpTo: (offset: number) => void;
}

export function createInstantSqlChannel(): InstantSqlChannel {
  let state: InstantSqlSnapshot = { draft: null, ran: null, jump: null };
  const listeners = new Set<() => void>();
  const set = (next: Partial<InstantSqlSnapshot>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish: (draft) => set({ draft }),
    markRun: (ran) => set({ ran: ran ?? state.draft }),
    jumpTo: (offset) => set({ jump: { offset, nonce: (state.jump?.nonce ?? 0) + 1 } }),
  };
}

/** The panel's channel while Instant SQL is on; it runs as you type, so only on the local engine. */
export function useInstantSqlChannel(local: boolean): InstantSqlChannel | null {
  const on = useSettingsStore((state) => state.sqlWorkspaceInstantPreview);
  const [channel] = useState(createInstantSqlChannel);
  return on && local ? channel : null;
}

/** True while the draft differs from what last ran, in text or in the part the cursor is on. */
export function instantPreviewVisible({ draft, ran }: InstantSqlSnapshot, queryId: string): boolean {
  if (!draft?.plan || draft.queryId !== queryId) return false;
  return !ran || ran.queryId !== draft.queryId || ran.text !== draft.text || ran.plan?.targetKey !== draft.plan.targetKey;
}
