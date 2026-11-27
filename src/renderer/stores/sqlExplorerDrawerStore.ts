import { create } from 'zustand';
import { useWorkspaceSqlStore } from './workspaceSqlStore';

interface SqlExplorerDrawerState {
  /** The SQL tab is too narrow for the Explorer beside the editor, so it opens as a drawer. */
  readonly compact: boolean;
  readonly open: boolean;
  setCompact: (compact: boolean) => void;
  setOpen: (open: boolean) => void;
}

/** Window-width state of the SQL Explorer: never persisted, never synced across tabs. */
export const useSqlExplorerDrawerStore = create<SqlExplorerDrawerState>()((set) => ({
  compact: false,
  open: false,
  setCompact: (compact) => set((state) => (state.compact === compact ? state : { compact, open: false })),
  setOpen: (open) => set((state) => (state.open === open ? state : { open })),
}));

/** Cmd/Ctrl+B, the rail and the fold button: the drawer while compact, the persisted fold otherwise. */
export function toggleSqlExplorer(): void {
  const drawer = useSqlExplorerDrawerStore.getState();
  if (drawer.compact) drawer.setOpen(!drawer.open);
  else useWorkspaceSqlStore.getState().toggleExplorerFolded();
}
