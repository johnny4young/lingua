/**
 * RL-094 Slice 3 fold G — surface claim for the capsule browse
 * overlay's `capsule.browse_opened` telemetry.
 *
 * The overlay fires the event once per mount, but it can be opened
 * from four entry points (keyboard shortcut, command palette, the
 * Settings → Run Capsules button, and the floating action pill). Each
 * opener claims its surface immediately before opening; the overlay
 * reads + clears the claim on mount. Mirrors the
 * `privacyTrustTelemetry` surface-claim pattern, minus the
 * once-per-session fire guard (every browse-open is a distinct user
 * action worth counting).
 */

export type CapsuleBrowseSurface =
  | 'palette'
  | 'shortcut'
  | 'settings'
  | 'action-pill';

let pendingSurface: CapsuleBrowseSurface | null = null;

export function claimCapsuleListSurface(surface: CapsuleBrowseSurface): void {
  pendingSurface = surface;
}

export function readCapsuleListSurfaceForMount(
  fallback: CapsuleBrowseSurface
): CapsuleBrowseSurface {
  const surface = pendingSurface ?? fallback;
  pendingSurface = null;
  return surface;
}

export function _resetCapsuleListSurfaceForTesting(): void {
  pendingSurface = null;
}
