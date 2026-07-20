/**
 * implementation — one-shot handoff for a pasted capsule.
 *
 * The smart-paste router (`applyPasteIntent`) cannot open the capsule-import
 * overlay directly (the overlay slot is App-local state). Instead it stashes
 * the pasted JSON here and emits `capsule.openImport`, which the existing App
 * listener maps to `openOverlay('capsule-import')`.
 * `CapsuleImportOverlay` then takes the seed on mount and decodes it, so the
 * confirm-first preview opens pre-filled instead of empty.
 *
 * Module-level + one-shot (take clears it) so a stale seed never bleeds into a
 * later overlay opened from Settings or the palette.
 */
let pendingSource: string | null = null;

/** Stash the pasted capsule JSON for the next capsule-import overlay open. */
export function setPendingCapsuleImportSource(source: string): void {
  pendingSource = source;
}

/** Return and clear the stashed capsule JSON, or null when none is pending. */
export function takePendingCapsuleImportSource(): string | null {
  const source = pendingSource;
  pendingSource = null;
  return source;
}
