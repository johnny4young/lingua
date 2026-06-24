import { describe, it, expect } from 'vitest';
import {
  NETWORK_ACTIVITY_FEATURES,
  buildNetworkActivityRows,
  formatRelativeTimestamp,
  latestEventAtByFeature,
} from '../../../src/renderer/components/Settings/privacyTrustHelpers';
import type { TrustEvent } from '../../../src/renderer/stores/trustEventStore';

function evt(overrides: Partial<TrustEvent> & Pick<TrustEvent, 'feature' | 'at'>): TrustEvent {
  return {
    id: overrides.id ?? overrides.at,
    action: overrides.action ?? 'x',
    sensitivity: overrides.sensitivity ?? 'low',
    summary: overrides.summary ?? '',
    ...overrides,
  };
}

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

describe('latestEventAtByFeature (RL-096 Slice 2)', () => {
  it('returns the newest at per feature from an unordered log', () => {
    const latest = latestEventAtByFeature([
      evt({ feature: 'capsule-export', at: 100 }),
      evt({ feature: 'telemetry', at: 250 }),
      evt({ feature: 'capsule-export', at: 300 }),
      evt({ feature: 'capsule-export', at: 200 }),
      evt({ feature: 'telemetry', at: 150 }),
    ]);
    expect(latest['capsule-export']).toBe(300);
    expect(latest.telemetry).toBe(250);
  });

  it('omits features with no recorded events', () => {
    const latest = latestEventAtByFeature([evt({ feature: 'updates', at: 42 })]);
    expect(latest.updates).toBe(42);
    expect(latest.license).toBeUndefined();
    expect(latest['share-link']).toBeUndefined();
  });

  it('returns an empty map for an empty log', () => {
    expect(latestEventAtByFeature([])).toEqual({});
  });
});

describe('buildNetworkActivityRows — license lastCall (RL-096 Slice 2 fold C)', () => {
  it('threads licenseVerifyLastAt onto the license row', () => {
    const rows = buildNetworkActivityRows({
      telemetryConsent: 'granted',
      licenseStatus: 'pro',
      capsuleExportLastAt: 111,
      telemetryLastAt: 222,
      updateCheckLastAt: 333,
      licenseVerifyLastAt: 444,
    });
    expect(rows.find((r) => r.feature === 'license')?.lastCallAt).toBe(444);
    expect(rows.find((r) => r.feature === 'capsule-export')?.lastCallAt).toBe(111);
    expect(rows.find((r) => r.feature === 'telemetry')?.lastCallAt).toBe(222);
    expect(rows.find((r) => r.feature === 'updates')?.lastCallAt).toBe(333);
  });

  it('defaults license lastCall to null when no verify has happened', () => {
    const rows = buildNetworkActivityRows({
      telemetryConsent: 'declined',
      licenseStatus: 'free',
      capsuleExportLastAt: null,
      telemetryLastAt: null,
      updateCheckLastAt: null,
    });
    expect(rows.find((r) => r.feature === 'license')?.lastCallAt).toBeNull();
  });
});

describe('formatRelativeTimestamp — localized privacy labels', () => {
  it('keeps the default compact English fallback for pure helper callers', () => {
    expect(formatRelativeTimestamp(1_000, 46_000)).toBe('45s ago');
    expect(formatRelativeTimestamp(1_000, 181_000)).toBe('3m ago');
    expect(formatRelativeTimestamp(1_000, 7_201_000)).toBe('2h ago');
  });

  it('uses the caller translator for seconds, minutes, and hours', () => {
    const calls: Array<{ key: string; count: number }> = [];
    const translate = (key: string, options: { readonly count: number }) => {
      calls.push({ key, count: options.count });
      return `translated:${key}:${options.count}`;
    };

    expect(formatRelativeTimestamp(1_000, 2_000, translate)).toBe(
      'translated:settings.privacy.relative.seconds:1'
    );
    expect(formatRelativeTimestamp(1_000, 61_000, translate)).toBe(
      'translated:settings.privacy.relative.minutes:1'
    );
    expect(formatRelativeTimestamp(1_000, 3_601_000, translate)).toBe(
      'translated:settings.privacy.relative.hours:1'
    );
    expect(calls).toEqual([
      { key: 'settings.privacy.relative.seconds', count: 1 },
      { key: 'settings.privacy.relative.minutes', count: 1 },
      { key: 'settings.privacy.relative.hours', count: 1 },
    ]);
  });
});
