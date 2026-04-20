/**
 * RL-067 bootstrap — every skip branch (kill switch, missing endpoint, no
 * consent) must short-circuit before the reporter starts. Unified-consent is
 * verified by making the `readConsentAtBoot` hook the only way consent
 * enters `bootCrashReporter`, so if the renderer persists `declined` the
 * reporter stays off.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const crashReporterStart = vi.fn();

vi.mock('electron', () => ({
  crashReporter: {
    start: crashReporterStart,
  },
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0' },
}));

describe('bootCrashReporter', () => {
  beforeEach(() => {
    crashReporterStart.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips with kill-switch when VITE/ENV kill switch is set', async () => {
    const { bootCrashReporter } = await import('../../src/main/crashReporter');
    const result = await bootCrashReporter({
      appVersion: '0.1.0',
      killSwitch: true,
      endpoint: 'https://example.test/report',
      readConsentAtBoot: async () => 'granted',
    });
    expect(result).toEqual({ status: 'skipped-kill-switch' });
    expect(crashReporterStart).not.toHaveBeenCalled();
  });

  it('skips when no endpoint is configured', async () => {
    const { bootCrashReporter } = await import('../../src/main/crashReporter');
    const result = await bootCrashReporter({
      appVersion: '0.1.0',
      killSwitch: false,
      readConsentAtBoot: async () => 'granted',
    });
    expect(result.status).toBe('skipped-no-endpoint');
    expect(crashReporterStart).not.toHaveBeenCalled();
  });

  it('skips when consent is unset or declined — unified with RL-065 telemetry flag', async () => {
    const { bootCrashReporter } = await import('../../src/main/crashReporter');
    for (const consent of ['unset', 'declined'] as const) {
      crashReporterStart.mockClear();
      const result = await bootCrashReporter({
        appVersion: '0.1.0',
        killSwitch: false,
        endpoint: 'https://example.test/report',
        readConsentAtBoot: async () => consent,
      });
      expect(result).toEqual({ status: 'skipped-no-consent', reason: consent });
      expect(crashReporterStart).not.toHaveBeenCalled();
    }
  });

  it('starts the reporter with a minimal extra tag when consent is granted', async () => {
    const { bootCrashReporter } = await import('../../src/main/crashReporter');
    const result = await bootCrashReporter({
      appVersion: '0.1.0',
      killSwitch: false,
      endpoint: 'https://example.test/report',
      readConsentAtBoot: async () => 'granted',
    });
    expect(result).toEqual({ status: 'started' });
    expect(crashReporterStart).toHaveBeenCalledTimes(1);
    const options = crashReporterStart.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options?.uploadToServer).toBe(true);
    expect(options?.submitURL).toBe('https://example.test/report');
    // The `extra` map must not carry user-identifying data — only appVersion.
    expect(options?.extra).toEqual({ appVersion: '0.1.0' });
  });
});

describe('parsePersistedTelemetryConsent', () => {
  it('returns unset for empty or malformed snapshots', async () => {
    const { parsePersistedTelemetryConsent } = await import('../../src/main/crashReporter');
    expect(parsePersistedTelemetryConsent(null)).toBe('unset');
    expect(parsePersistedTelemetryConsent('')).toBe('unset');
    expect(parsePersistedTelemetryConsent('{not json')).toBe('unset');
    expect(parsePersistedTelemetryConsent(JSON.stringify({ state: { telemetryConsent: 'weird' } }))).toBe(
      'unset'
    );
  });

  it('extracts the telemetry consent from the persisted lingua-settings snapshot', async () => {
    const { parsePersistedTelemetryConsent } = await import('../../src/main/crashReporter');
    expect(
      parsePersistedTelemetryConsent(
        JSON.stringify({ state: { telemetryConsent: 'granted' }, version: 0 })
      )
    ).toBe('granted');
    expect(
      parsePersistedTelemetryConsent(
        JSON.stringify({ state: { telemetryConsent: 'declined' }, version: 0 })
      )
    ).toBe('declined');
  });

  it('rejects non-wrapped snapshot shapes as unset so format drift cannot grant consent', async () => {
    const { parsePersistedTelemetryConsent } = await import('../../src/main/crashReporter');
    // A top-level `telemetryConsent` without the `state` wrapper is not the
    // shape zustand-persist produces; accepting it would make the crash
    // reporter start on unrelated JSON files that happen to carry a
    // matching key (e.g. a snippet export someone named settings.json).
    expect(parsePersistedTelemetryConsent(JSON.stringify({ telemetryConsent: 'granted' }))).toBe(
      'unset'
    );
    expect(parsePersistedTelemetryConsent(JSON.stringify({ state: null }))).toBe('unset');
    expect(parsePersistedTelemetryConsent(JSON.stringify('granted'))).toBe('unset');
  });
});

describe('readConsentFromSettingsFile', () => {
  it('returns unset for missing files', async () => {
    const { readConsentFromSettingsFile } = await import('../../src/main/crashReporter');
    const result = await readConsentFromSettingsFile('/tmp/__does_not_exist__.json');
    expect(result).toBe('unset');
  });

  it('returns unset for malformed JSON', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'lingua-'));
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{not json');

    const { readConsentFromSettingsFile } = await import('../../src/main/crashReporter');
    const result = await readConsentFromSettingsFile(file);
    expect(result).toBe('unset');
  });

  it('returns the persisted consent value when it is one of the three known strings', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'lingua-'));
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ state: { telemetryConsent: 'granted' } }));

    const { readConsentFromSettingsFile } = await import('../../src/main/crashReporter');
    const result = await readConsentFromSettingsFile(file);
    expect(result).toBe('granted');
  });
});
