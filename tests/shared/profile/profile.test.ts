import { describe, expect, it } from 'vitest';
import {
  PROFILE_SCHEMA_VERSION,
  migrateProfile,
  parseAndValidateProfile,
  profileFilename,
  type LinguaProfile,
} from '#src/shared/profile/profile';

const VALID_V1: LinguaProfile = {
  schemaVersion: 1,
  exportedAt: '2026-05-07T14:30:00.000Z',
  appVersion: '0.2.4',
  data: {
    settings: {
      theme: 'dark',
      vimMode: true,
      fontSize: 14,
    },
    snippets: [
      {
        id: 'a1',
        language: 'javascript',
        label: 'log hi',
        description: '',
        code: 'console.log(1)',
        createdAt: 1_700_000_000_000,
      },
    ],
    envVars: {
      global: { LINGUA_DEMO: 'one' },
      project: {
        '/proj': { SCOPED: 'two' },
      },
    },
  },
};

describe('parseAndValidateProfile', () => {
  it('round-trips a valid v1 profile', () => {
    const result = parseAndValidateProfile(JSON.stringify(VALID_V1));
    expect(result).toEqual({ ok: true, profile: VALID_V1 });
  });

  it('rejects malformed JSON', () => {
    const result = parseAndValidateProfile('{not json');
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-json' } });
  });

  it('rejects unknown schemaVersion', () => {
    const result = parseAndValidateProfile(
      JSON.stringify({ ...VALID_V1, schemaVersion: 2 })
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: 'unsupported-version', foundVersion: 2 },
    });
  });

  it('rejects v1 missing the data envelope', () => {
    const result = parseAndValidateProfile(
      JSON.stringify({ schemaVersion: 1, exportedAt: '', appVersion: '' })
    );
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'invalid-shape', field: 'data' },
    });
  });

  it('rejects non-object root', () => {
    expect(parseAndValidateProfile(JSON.stringify([1, 2, 3]))).toMatchObject({
      ok: false,
      error: { kind: 'invalid-shape', field: 'root' },
    });
  });

  it('strips unknown / forbidden fields from settings (license, telemetryConsent)', () => {
    const malicious = {
      schemaVersion: 1,
      exportedAt: VALID_V1.exportedAt,
      appVersion: '0.2.4',
      data: {
        settings: {
          theme: 'dark',
          telemetryConsent: 'granted',
          licenseToken: 'fake.jwt.payload',
          deviceId: 'leak-me',
          hasCompletedTour: true,
          lastSeenVersion: '0.5.0',
        },
        snippets: [],
        envVars: { global: {}, project: {} },
      },
    };
    const result = parseAndValidateProfile(JSON.stringify(malicious));
    if (!result.ok) throw new Error('expected ok');
    const settings = result.profile.data.settings as Record<string, unknown>;
    expect(settings.theme).toBe('dark');
    expect(settings).not.toHaveProperty('telemetryConsent');
    expect(settings).not.toHaveProperty('licenseToken');
    expect(settings).not.toHaveProperty('deviceId');
    expect(settings).not.toHaveProperty('hasCompletedTour');
    expect(settings).not.toHaveProperty('lastSeenVersion');
  });

  it('drops malformed portable setting values before they reach the store', () => {
    const malformed = {
      schemaVersion: 1,
      exportedAt: VALID_V1.exportedAt,
      appVersion: '0.2.4',
      data: {
        settings: {
          theme: 'dark',
          fontSize: '32',
          fontLigatures: 'true',
          layoutPreset: 'floating',
          maxLoopIterations: 42,
          language: ['es'],
        },
        snippets: [],
        envVars: { global: {}, project: {} },
      },
    };
    const result = parseAndValidateProfile(JSON.stringify(malformed));
    if (!result.ok) throw new Error('expected ok');
    expect(result.profile.data.settings).toEqual({ theme: 'dark' });
  });

  it('round-trips the internal restoreSessionMode enum and validates it', () => {
    const withMode = (mode: unknown) =>
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: VALID_V1.exportedAt,
        appVersion: '0.2.4',
        data: {
          settings: { restoreSessionMode: mode },
          snippets: [],
          envVars: { global: {}, project: {} },
        },
      });
    for (const mode of ['never', 'ask', 'always']) {
      const result = parseAndValidateProfile(withMode(mode));
      if (!result.ok) throw new Error('expected ok');
      expect(result.profile.data.settings.restoreSessionMode).toBe(mode);
    }
    // An out-of-enum value is dropped (the store merge would coerce to 'ask').
    const bad = parseAndValidateProfile(withMode('sometimes'));
    if (!bad.ok) throw new Error('expected ok');
    expect(bad.profile.data.settings).not.toHaveProperty('restoreSessionMode');
  });

  it('maps a legacy restoreSession boolean to restoreSessionMode on import (internal back-compat)', () => {
    const withLegacy = (restoreSession: boolean) =>
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: VALID_V1.exportedAt,
        appVersion: '0.2.4',
        data: {
          settings: { restoreSession },
          snippets: [],
          envVars: { global: {}, project: {} },
        },
      });
    const enabled = parseAndValidateProfile(withLegacy(true));
    if (!enabled.ok) throw new Error('expected ok');
    expect(enabled.profile.data.settings.restoreSessionMode).toBe('always');
    expect(enabled.profile.data.settings).not.toHaveProperty('restoreSession');

    const disabled = parseAndValidateProfile(withLegacy(false));
    if (!disabled.ok) throw new Error('expected ok');
    expect(disabled.profile.data.settings.restoreSessionMode).toBe('ask');
  });

  it('sanitizes imported env-var keys and values through the shared guard', () => {
    const oversizedValue = 'x'.repeat(32_769);
    const malicious = {
      schemaVersion: 1,
      exportedAt: VALID_V1.exportedAt,
      appVersion: '0.2.4',
      data: {
        settings: {},
        snippets: [],
        envVars: {
          global: {
            GOOD_KEY: 'kept',
            PATH: '/tmp/malicious',
            '1BAD': 'dropped',
            TOO_BIG: oversizedValue,
          },
          project: {
            '/proj': {
              PROJECT_OK: 'kept',
              HOME: '/tmp/home',
            },
          },
        },
      },
    };
    const result = parseAndValidateProfile(JSON.stringify(malicious));
    if (!result.ok) throw new Error('expected ok');
    expect(result.profile.data.envVars).toEqual({
      global: { GOOD_KEY: 'kept' },
      project: { '/proj': { PROJECT_OK: 'kept' } },
    });
  });

  it('preserves appVersion on round-trip but does not validate it', () => {
    const ancient = parseAndValidateProfile(
      JSON.stringify({ ...VALID_V1, appVersion: '0.0.1' })
    );
    if (!ancient.ok) throw new Error('expected ok');
    expect(ancient.profile.appVersion).toBe('0.0.1');

    const future = parseAndValidateProfile(
      JSON.stringify({ ...VALID_V1, appVersion: '99.99.99' })
    );
    if (!future.ok) throw new Error('expected ok');
    expect(future.profile.appVersion).toBe('99.99.99');
  });
});

describe('migrateProfile (v0 → v1)', () => {
  it('lifts a flat v0 shape (no envelope, no schemaVersion) into v1', () => {
    const v0 = {
      settings: { theme: 'light', fontSize: 18 },
      snippets: [
        {
          id: 'old-1',
          language: 'typescript',
          label: 'older snippet',
          description: 'pre-versioning',
          code: 'export {};',
          createdAt: 1,
        },
      ],
      envVars: { global: { OLD: '1' }, project: {} },
    };
    const lifted = migrateProfile(v0);
    expect(lifted.schemaVersion).toBe(PROFILE_SCHEMA_VERSION);
    expect(lifted.data.settings.theme).toBe('light');
    expect(lifted.data.snippets).toHaveLength(1);
    expect(lifted.data.envVars.global.OLD).toBe('1');
  });

  it('handles v0 fixtures without snippets / envVars', () => {
    const lifted = migrateProfile({ settings: { vimMode: true } });
    expect(lifted.data.snippets).toEqual([]);
    expect(lifted.data.envVars).toEqual({ global: {}, project: {} });
  });
});

describe('profileFilename', () => {
  it('produces a Windows-safe filename (no colons)', () => {
    const filename = profileFilename(new Date('2026-05-07T14:30:00.000Z'));
    expect(filename).toBe('lingua-profile-2026-05-07T14-30-00.json');
    expect(filename).not.toMatch(/:/u);
  });

  it('strips milliseconds for a stable shape', () => {
    const filename = profileFilename(new Date('2026-05-07T14:30:45.999Z'));
    expect(filename).toBe('lingua-profile-2026-05-07T14-30-45.json');
  });
});
