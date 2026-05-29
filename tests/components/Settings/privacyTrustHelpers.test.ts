import { describe, it, expect } from 'vitest';
import {
  NETWORK_ACTIVITY_FEATURES,
  buildNetworkActivityRows,
} from '../../../src/renderer/components/Settings/privacyTrustHelpers';

/**
 * RL-044 next slice fold E — the console image clipboard paste surface
 * is disclosed in the Privacy + Trust dashboard network table as a
 * local-only, in-memory feature.
 */
describe('Privacy dashboard — consoleImagePaste row (RL-044 fold E)', () => {
  it('registers consoleImagePaste in the closed feature enum', () => {
    expect(NETWORK_ACTIVITY_FEATURES).toContain('consoleImagePaste');
  });

  it('builds an enabled, never-called row for consoleImagePaste', () => {
    const rows = buildNetworkActivityRows({
      telemetryConsent: 'granted',
      licenseStatus: 'pro',
      capsuleExportLastAt: null,
      telemetryLastAt: null,
      updateCheckLastAt: null,
    });
    const row = rows.find((r) => r.feature === 'consoleImagePaste');
    expect(row).toBeDefined();
    // Local-only + in-memory: enabled (the input surface exists) but
    // never carries a network call, so lastCallAt stays null forever.
    expect(row?.status).toBe('enabled');
    expect(row?.lastCallAt).toBeNull();
  });
});
