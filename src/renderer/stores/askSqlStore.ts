import { create } from 'zustand';

/** The SQL Ask AI dialog's open state, so a starter prompt can open it with its question typed in. */
interface AskSqlState {
  /** Null while closed; empty when opened from the Ask AI button. */
  readonly question: string | null;
  readonly open: (question?: string) => void;
  readonly close: () => void;
}

export const useAskSqlStore = create<AskSqlState>(set => ({
  question: null,
  open: (question = '') => set({ question }),
  close: () => set({ question: null }),
}));
