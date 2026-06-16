/**
 * RL-112 fold C — module-level focuser for the persistent status bar.
 *
 * Same module-handle idiom as `editorAccess`: the mounted `<StatusBar>`
 * registers a function that moves keyboard focus to its first segment
 * button; the "Focus status bar" command palette action calls
 * `focusStatusBar()` without threading a ref through the palette tree.
 * Returns `false` when the bar is unmounted (toggle OFF) so the caller
 * can decide what a no-op means.
 */

let focuser: (() => void) | null = null;

/** RL-112 — register / clear the status-bar focuser. Pass `null` on unmount. */
export function setStatusBarFocuser(fn: (() => void) | null): void {
  focuser = fn;
}

/**
 * RL-112 — focus the status bar's first segment. Returns `true` when a focuser
 * was registered (bar mounted) and invoked, `false` otherwise.
 */
export function focusStatusBar(): boolean {
  if (focuser) {
    focuser();
    return true;
  }
  return false;
}
