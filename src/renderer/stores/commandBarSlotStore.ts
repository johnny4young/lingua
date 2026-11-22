import { create } from 'zustand';

/** The two places a surface can fill in the command bar. */
export type CommandBarSlotKind = 'context' | 'verb';

interface CommandBarSlotClaim {
  id: string;
  priority: number;
  seq: number;
}

/** Run tests in file, offered in the code Run menu for a test file of the open project. */
export interface ProjectTestFileRun {
  disabled: boolean;
  run: () => void;
}

interface CommandBarSlotState {
  hosts: Record<CommandBarSlotKind, HTMLElement | null>;
  /** Set by the code editor, so the bar never loads the project stores itself. */
  testFileRun: ProjectTestFileRun | null;
  setTestFileRun: (run: ProjectTestFileRun | null) => void;
  claims: Record<CommandBarSlotKind, readonly CommandBarSlotClaim[]>;
  setHost: (kind: CommandBarSlotKind, host: HTMLElement | null) => void;
  clearHost: (kind: CommandBarSlotKind, host: HTMLElement) => void;
  claim: (kind: CommandBarSlotKind, id: string, priority: number) => void;
  release: (kind: CommandBarSlotKind, id: string) => void;
}

let nextSeq = 0;

export const useCommandBarSlotStore = create<CommandBarSlotState>()((set) => ({
  hosts: { context: null, verb: null },
  claims: { context: [], verb: [] },
  testFileRun: null,
  setTestFileRun: (testFileRun) => set({ testFileRun }),
  setHost: (kind, host) => set((state) => ({ hosts: { ...state.hosts, [kind]: host } })),
  // A host that unmounts after its replacement mounted must not clear the new one.
  clearHost: (kind, host) =>
    set((state) => (state.hosts[kind] === host ? { hosts: { ...state.hosts, [kind]: null } } : state)),
  claim: (kind, id, priority) =>
    set((state) => ({
      claims: {
        ...state.claims,
        [kind]: [...state.claims[kind].filter((entry) => entry.id !== id), { id, priority, seq: ++nextSeq }],
      },
    })),
  release: (kind, id) =>
    set((state) =>
      state.claims[kind].some((entry) => entry.id === id)
        ? { claims: { ...state.claims, [kind]: state.claims[kind].filter((entry) => entry.id !== id) } }
        : state
    ),
}));

/** The claim that owns a slot: highest priority, then the most recent. */
export function activeCommandBarClaim(claims: readonly CommandBarSlotClaim[]): string | null {
  let winner: CommandBarSlotClaim | null = null;
  for (const entry of claims) {
    if (!winner || entry.priority > winner.priority || (entry.priority === winner.priority && entry.seq > winner.seq)) {
      winner = entry;
    }
  }
  return winner?.id ?? null;
}

export function useCommandBarSlotClaimed(kind: CommandBarSlotKind): boolean {
  return useCommandBarSlotStore((state) => state.claims[kind].length > 0);
}
