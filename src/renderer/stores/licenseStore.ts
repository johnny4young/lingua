/**
 * Renderer license store — factory + facade.
 *
 * The 972-line monolith was carved along the web/desktop seam with ZERO public
 * API change; this file is the thin facade that picks the right implementation
 * at module load and re-exports the public surface:
 *
 *   - `licenseTypes`          — LicenseStatus / ServerSyncState / RecoverHint /
 *                               LicenseState + status constants + Set/Get types
 *   - `licenseBridge`         — `readLicenseBridge()` + `LicenseBridge` type
 *   - `licenseWebVerify`      — embedded Ed25519 key + local verify (web)
 *   - `licenseServerMappers`  — server status/failure → local status
 *   - `licenseTokenHelpers`   — issuedAt/issuedTo decode + stale-token pickup
 *   - `licenseWebActions`     — setLicenseToken / clearLicense / removeDevice /
 *                               clearRecoverHint factory (web)
 *   - `licenseWebRevalidate`  — the web `revalidate` factory
 *   - `licenseWebStore`       — web state creator + persist + cross-tab listener
 *   - `licenseDesktopStore`   — bridge-delegating desktop store (no persist)
 *
 * `createLicenseStore()` chooses the desktop store when the IPC bridge is
 * present (packaged app) and the web store otherwise (web build + JSDOM tests),
 * exactly as the inline factory did. The type re-export keeps every consumer's
 * `import { … } from '../stores/licenseStore'` path unchanged.
 */
import { readLicenseBridge } from './licenseBridge';
import { createWebStore } from './licenseWebStore';
import { createDesktopStore } from './licenseDesktopStore';
import { registerLicenseTrustCapture } from './licenseTrustCapture';

function createLicenseStore() {
  const bridge = readLicenseBridge();
  return bridge ? createDesktopStore(bridge) : createWebStore();
}

export const useLicenseStore = createLicenseStore();

// implementation note — wire license-verify trust capture (logic extracted
// to keep this facade thin; see licenseTrustCapture.ts).
registerLicenseTrustCapture(useLicenseStore);

// Public API re-export — unchanged import path for the existing consumers.
export type {
  LicenseStatus,
  ServerSyncState,
  RecoverHint,
  LicenseState,
} from './licenseTypes';
