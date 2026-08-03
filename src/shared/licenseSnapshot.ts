/** Desktop license state structured-cloned from main to renderer. */

import type { LicenseVerificationResult } from './license';
import type {
  LicenseServerDeviceLimit,
  LicenseServerDevicesBucket,
  LicenseServerSyncState,
} from './licenseServerTypes';

export type LicenseStatus =
  | { kind: 'free' }
  | { kind: 'invalid'; reason: string; message?: string }
  | {
      kind: 'active';
      verification: Extract<LicenseVerificationResult, { ok: true }>;
    }
  | {
      kind: 'grace';
      verification: Extract<LicenseVerificationResult, { ok: true }>;
    };

export interface LicenseSnapshot {
  token: string | null;
  status: LicenseStatus;
  deviceId: string;
  lastVerifiedAt: number | null;
  serverSync: LicenseServerSyncState;
  devices: LicenseServerDevicesBucket | null;
  deviceLimit: LicenseServerDeviceLimit | null;
}
