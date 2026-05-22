export type PrivacyDashboardSurface = 'settings' | 'palette';

const adoptionFireGuard: Record<PrivacyDashboardSurface, boolean> = {
  settings: false,
  palette: false,
};

let pendingSurfaceOverride: PrivacyDashboardSurface | null = null;

export function markPrivacyDashboardSurfaceForNextMount(
  surface: PrivacyDashboardSurface
): void {
  pendingSurfaceOverride = surface;
}

export function readPrivacyDashboardSurfaceForMount(
  fallback: PrivacyDashboardSurface
): PrivacyDashboardSurface {
  return pendingSurfaceOverride ?? fallback;
}

export function clearPrivacyDashboardSurfaceClaim(): void {
  pendingSurfaceOverride = null;
}

export function hasPrivacyDashboardSurfaceFired(
  surface: PrivacyDashboardSurface
): boolean {
  return adoptionFireGuard[surface];
}

export function markPrivacyDashboardSurfaceFired(
  surface: PrivacyDashboardSurface
): void {
  adoptionFireGuard[surface] = true;
}

export function _resetPrivacyDashboardTelemetryForTesting(): void {
  adoptionFireGuard.settings = false;
  adoptionFireGuard.palette = false;
  pendingSurfaceOverride = null;
}
