import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyProfile } from '@/utils/profileImport';
import { migrateProfile, parseAndValidateProfile } from '#src/shared/profile/profile';
import { useEnvVarsStore } from '@/stores/envVarsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSnippetsStore } from '@/stores/snippetsStore';
import type { LinguaProfile } from '#src/shared/profile/profile';

const initialSettings = useSettingsStore.getState();
const initialSnippets = useSnippetsStore.getState();
const initialEnvVars = useEnvVarsStore.getState();

function buildProfile(partial: Partial<LinguaProfile['data']>): LinguaProfile {
  return {
    schemaVersion: 1,
    exportedAt: '2026-05-07T14:30:00.000Z',
    appVersion: '0.2.4',
    data: {
      settings: partial.settings ?? {},
      snippets: partial.snippets ?? [],
      envVars: partial.envVars ?? { global: {}, project: {} },
    },
  };
}

describe('applyProfile', () => {
  beforeEach(() => {
    useSettingsStore.setState({ ...initialSettings, vimMode: false, fontSize: 14 });
    useSnippetsStore.setState({
      ...initialSnippets,
      snippets: [
        {
          id: 'current-1',
          language: 'javascript',
          label: 'Current snippet',
          description: '',
          code: 'console.log(0)',
          createdAt: 0,
        },
      ],
    });
    useEnvVarsStore.setState({
      ...initialEnvVars,
      global: { CURRENT: 'now' },
      project: { '/proj-a': { LOCAL: 'a' } },
      tab: {},
    });
  });

  afterEach(() => {
    useSettingsStore.setState(initialSettings, true);
    useSnippetsStore.setState(initialSnippets, true);
    useEnvVarsStore.setState(initialEnvVars, true);
  });

  it('replace policy overwrites snippets, settings, and env vars', () => {
    const profile = buildProfile({
      settings: { vimMode: true, fontSize: 20 },
      snippets: [
        {
          id: 'imp-1',
          language: 'typescript',
          label: 'Imported',
          description: '',
          code: 'export {};',
          createdAt: 1,
        },
      ],
      envVars: {
        global: { IMPORTED: 'one' },
        project: { '/proj-b': { B_KEY: 'two' } },
      },
    });
    applyProfile(profile, 'replace');
    expect(useSettingsStore.getState().vimMode).toBe(true);
    expect(useSettingsStore.getState().fontSize).toBe(20);
    expect(useSnippetsStore.getState().snippets).toHaveLength(1);
    expect(useSnippetsStore.getState().snippets[0].id).toBe('imp-1');
    expect(useEnvVarsStore.getState().global).toEqual({ IMPORTED: 'one' });
    expect(useEnvVarsStore.getState().project).toEqual({ '/proj-b': { B_KEY: 'two' } });
  });

  it('merge policy concats snippets and rebinds id collisions', () => {
    const profile = buildProfile({
      snippets: [
        {
          id: 'current-1', // collides with the existing snippet id
          language: 'javascript',
          label: 'Imported A',
          description: '',
          code: 'console.log(2)',
          createdAt: 2,
        },
        {
          id: 'fresh-2',
          language: 'javascript',
          label: 'Imported B',
          description: '',
          code: 'console.log(3)',
          createdAt: 3,
        },
      ],
    });
    applyProfile(profile, 'merge');
    const snippets = useSnippetsStore.getState().snippets;
    expect(snippets).toHaveLength(3);
    expect(snippets.map((s) => s.id)).toEqual(['current-1', 'current-1-imported-1', 'fresh-2']);
    expect(snippets.map((s) => s.label)).toContain('Current snippet');
    expect(snippets.map((s) => s.label)).toContain('Imported A');
  });

  it('merge policy: env vars imported wins on key collision', () => {
    const profile = buildProfile({
      envVars: { global: { CURRENT: 'imported-wins' }, project: {} },
    });
    applyProfile(profile, 'merge');
    expect(useEnvVarsStore.getState().global.CURRENT).toBe('imported-wins');
  });

  it('preserve policy keeps current settings on collision', () => {
    const profile = buildProfile({
      settings: { vimMode: true, fontSize: 99 },
    });
    applyProfile(profile, 'preserve');
    // Booleans always carry a value — `false` is just as present as `true`,
    // so preserve treats vimMode as non-empty and skips the import. Numbers
    // likewise: 14 is not empty.
    expect(useSettingsStore.getState().fontSize).toBe(14);
    expect(useSettingsStore.getState().vimMode).toBe(false);
  });

  it('preserve policy: env vars current wins on key collision', () => {
    const profile = buildProfile({
      envVars: { global: { CURRENT: 'should-not-win', NEW: 'fresh' }, project: {} },
    });
    applyProfile(profile, 'preserve');
    expect(useEnvVarsStore.getState().global.CURRENT).toBe('now');
    expect(useEnvVarsStore.getState().global.NEW).toBe('fresh');
  });

  it('preserve policy: snippet label collision skipped, label-novel snippet added', () => {
    const profile = buildProfile({
      snippets: [
        {
          id: 'imp-collide',
          language: 'javascript',
          label: 'Current snippet', // collides with current label
          description: '',
          code: 'console.log(99)',
          createdAt: 4,
        },
        {
          id: 'imp-fresh',
          language: 'javascript',
          label: 'Brand new',
          description: '',
          code: 'console.log(5)',
          createdAt: 5,
        },
      ],
    });
    applyProfile(profile, 'preserve');
    const snippets = useSnippetsStore.getState().snippets;
    expect(snippets).toHaveLength(2);
    expect(snippets.map((s) => s.label)).toEqual(['Current snippet', 'Brand new']);
  });

  it('migration v0 → v1 then apply works end-to-end', () => {
    const v0 = {
      settings: { vimMode: true, fontSize: 22 },
      snippets: [
        {
          id: 'old',
          language: 'javascript',
          label: 'Old',
          description: '',
          code: '/* old */',
          createdAt: 1,
        },
      ],
    };
    const lifted = migrateProfile(v0);
    applyProfile(lifted, 'replace');
    expect(useSettingsStore.getState().vimMode).toBe(true);
    expect(useSettingsStore.getState().fontSize).toBe(22);
    expect(useSnippetsStore.getState().snippets[0].label).toBe('Old');
  });

  it('a malicious profile carrying license fields gets stripped before apply', () => {
    const malicious = JSON.stringify({
      schemaVersion: 1,
      exportedAt: '2026-05-07T14:30:00.000Z',
      appVersion: '0.2.4',
      data: {
        settings: { vimMode: true, telemetryConsent: 'granted', licenseToken: 'fake.jwt' },
        snippets: [],
        envVars: { global: {}, project: {} },
      },
    });
    const parsed = parseAndValidateProfile(malicious);
    if (!parsed.ok) throw new Error('expected ok');
    applyProfile(parsed.profile, 'replace');
    // vimMode applied (allowlisted)
    expect(useSettingsStore.getState().vimMode).toBe(true);
    // telemetryConsent NOT touched — current value remains
    expect(useSettingsStore.getState().telemetryConsent).toBe(initialSettings.telemetryConsent);
  });

  it('Free-tier ceiling: importing 100 snippets grandfathers all of them', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      id: `bulk-${i}`,
      language: 'javascript',
      label: `Bulk ${i}`,
      description: '',
      code: `// ${i}`,
      createdAt: i,
    }));
    const profile = buildProfile({ snippets: many });
    applyProfile(profile, 'replace');
    expect(useSnippetsStore.getState().snippets).toHaveLength(100);
  });

  it('sanitizes env vars again before direct apply writes to the live store', () => {
    const profile = buildProfile({
      envVars: {
        global: {
          GOOD_KEY: 'kept',
          PATH: '/tmp/malicious',
          '1BAD': 'dropped',
        },
        project: {
          '/proj-b': {
            PROJECT_OK: 'kept',
            HOME: '/tmp/home',
          },
        },
      },
    });

    applyProfile(profile, 'replace');

    expect(useEnvVarsStore.getState().global).toEqual({ GOOD_KEY: 'kept' });
    expect(useEnvVarsStore.getState().project).toEqual({
      '/proj-b': { PROJECT_OK: 'kept' },
    });
  });
});
