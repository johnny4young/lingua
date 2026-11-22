/**
 * one-shot handoff for a pasted capsule, or a capsule file dropped on the list.
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
export type PendingCapsuleImport = { text: string } | { file: File };

let pending: PendingCapsuleImport | null = null;

/** Stash the pasted capsule JSON for the next capsule-import overlay open. */
export function setPendingCapsuleImportSource(source: string): void {
  pending = { text: source };
}

/** Stash a file dropped outside the overlay (the capsule list) for the next open. */
export function setPendingCapsuleImportFile(file: File): void {
  pending = { file };
}

/** Return and clear the stashed text or file, or null when none is pending. */
export function takePendingCapsuleImport(): PendingCapsuleImport | null {
  const seed = pending;
  pending = null;
  return seed;
}
