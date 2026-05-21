export type LanguageScorecardSurface = 'settings' | 'palette';

/**
 * Module-level guard so the `language_scorecard_viewed` event fires
 * at most once per page load (per surface). Resetting on full reload
 * matches the telemetry contract for other "viewed" events in the
 * repo (e.g. `runtime.variable_inspector_opened`).
 */
const adoptionFireGuard: Record<LanguageScorecardSurface, boolean> = {
  settings: false,
  palette: false,
};

/**
 * Surface override claimed by an out-of-band caller (typically the
 * command palette "Show language support" entry). Consumed by the
 * next mount of `LanguageSupportScorecard` exactly once, then
 * cleared. This keeps the telemetry contract honest: the component
 * is mounted once by `LanguagesSection` with no prop, so without an
 * override every adoption event would be tagged `'settings'`.
 */
let pendingSurfaceOverride: LanguageScorecardSurface | null = null;

export function markLanguageScorecardSurfaceForNextMount(
  surface: LanguageScorecardSurface
): void {
  pendingSurfaceOverride = surface;
}

export function readLanguageScorecardSurfaceForMount(
  fallback: LanguageScorecardSurface
): LanguageScorecardSurface {
  return pendingSurfaceOverride ?? fallback;
}

export function clearLanguageScorecardSurfaceClaim(): void {
  pendingSurfaceOverride = null;
}

export function hasLanguageScorecardSurfaceFired(
  surface: LanguageScorecardSurface
): boolean {
  return adoptionFireGuard[surface];
}

export function markLanguageScorecardSurfaceFired(
  surface: LanguageScorecardSurface
): void {
  adoptionFireGuard[surface] = true;
}

export function _resetLanguageScorecardAdoptionGuardForTesting(): void {
  adoptionFireGuard.settings = false;
  adoptionFireGuard.palette = false;
  pendingSurfaceOverride = null;
}
