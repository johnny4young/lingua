/**
 * Module-level handle so the global shortcut (`Mod+Alt+H`) can toggle the run
 * meter's Recent runs popover without piping a ref through the renderer tree.
 * The meter writes the opener on mount and clears it on unmount.
 */

export type RecentRunsPopoverOpener = () => void;

// A queued open expires, so a meter that mounts much later for another reason never pops the list.
const PENDING_MS = 2_000;
const ref: { opener: RecentRunsPopoverOpener | null; pendingUntil: number } = { opener: null, pendingUntil: 0 };

export function setRecentRunsPopoverOpener(opener: RecentRunsPopoverOpener | null): void {
  ref.opener = opener;
  if (opener && Date.now() <= ref.pendingUntil) {
    ref.pendingUntil = 0;
    opener();
  }
}

/**
 * Toggle the per-tab Recent runs popover if the meter is mounted and exposes
 * an opener. Returns `false` when none is registered, so the shortcut can open
 * the dock with `openRecentRunsPopoverWhenReady` or fall back to a notice.
 */
export function toggleRecentRunsPopover(): boolean {
  const opener = ref.opener;
  if (!opener) return false;
  opener();
  return true;
}

/** Open the popover as soon as the meter mounts, for a shortcut pressed while the dock is folded. */
export function openRecentRunsPopoverWhenReady(): void {
  ref.pendingUntil = Date.now() + PENDING_MS;
}
