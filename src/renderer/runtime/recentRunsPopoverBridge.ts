/**
 * RL-020 Slice 4 fold B — module-level handle so the global keyboard
 * shortcut (`Mod+Shift+H`) can toggle the result-panel pill's popover
 * without piping a ref through the renderer tree.
 *
 * Mirrors the `editorAccess` / `debuggerWorkerBridge` pattern: the
 * pill writes the opener on mount and clears it on unmount; the
 * keyboard handler reads it on demand and short-circuits when no
 * opener is registered (no pill mounted — no active runnable tab).
 */

export type RecentRunsPopoverOpener = () => void;

const ref: { opener: RecentRunsPopoverOpener | null } = { opener: null };

export function setRecentRunsPopoverOpener(opener: RecentRunsPopoverOpener | null): void {
  ref.opener = opener;
}

/**
 * Toggle the per-tab Recent runs popover if a pill is mounted and
 * exposes an opener. Returns `true` when the toggle dispatched,
 * `false` when no opener is registered (so the shortcut dispatcher
 * can fall back to a status notice).
 */
export function toggleRecentRunsPopover(): boolean {
  const opener = ref.opener;
  if (!opener) return false;
  opener();
  return true;
}
