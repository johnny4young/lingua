import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProfile, downloadProfileFile } from '@/utils/profileExport';
import { useEnvVarsStore } from '@/stores/envVarsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSnippetsStore } from '@/stores/snippetsStore';

const initialSettings = useSettingsStore.getState();
const initialSnippets = useSnippetsStore.getState();
const initialEnvVars = useEnvVarsStore.getState();

describe('buildProfile', () => {
  beforeEach(() => {
    useSettingsStore.setState({ ...initialSettings, vimMode: true, fontSize: 18 });
    useSnippetsStore.setState({
      ...initialSnippets,
      snippets: [
        {
          id: 's1',
          language: 'javascript',
          label: 'log',
          description: '',
          code: 'console.log(1)',
          createdAt: 1,
        },
      ],
    });
    useEnvVarsStore.setState({
      ...initialEnvVars,
      global: { LINGUA_DEMO: 'one' },
      project: {},
      tab: { 'tab-1': { TAB_SCOPED: 'should-not-export' } },
    });
  });

  afterEach(() => {
    useSettingsStore.setState(initialSettings, true);
    useSnippetsStore.setState(initialSnippets, true);
    useEnvVarsStore.setState(initialEnvVars, true);
  });

  it('emits the allowlist subset of settings', () => {
    const profile = buildProfile(new Date('2026-05-07T14:30:00.000Z'));
    expect(profile.schemaVersion).toBe(1);
    expect(profile.data.settings.vimMode).toBe(true);
    expect(profile.data.settings.fontSize).toBe(18);
  });

  it('does NOT export telemetry consent, tour state, or last-seen-version', () => {
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      telemetryConsent: 'granted',
      hasCompletedTour: true,
      lastSeenVersion: '0.5.0',
      nativeExecutionAcknowledged: true,
      suppressTourAutoStart: true,
    });
    const profile = buildProfile();
    const exported = profile.data.settings as Record<string, unknown>;
    expect(exported).not.toHaveProperty('telemetryConsent');
    expect(exported).not.toHaveProperty('hasCompletedTour');
    expect(exported).not.toHaveProperty('lastSeenVersion');
    expect(exported).not.toHaveProperty('nativeExecutionAcknowledged');
    expect(exported).not.toHaveProperty('suppressTourAutoStart');
  });

  it('includes snippets and env-vars but skips tab-scoped env vars', () => {
    const profile = buildProfile();
    expect(profile.data.snippets).toHaveLength(1);
    expect(profile.data.envVars.global.LINGUA_DEMO).toBe('one');
    expect(profile.data.envVars).not.toHaveProperty('tab');
  });
});

describe('downloadProfileFile', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
  let originalCreate: typeof URL.createObjectURL;
  let originalRevoke: typeof URL.revokeObjectURL;

  beforeEach(() => {
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    createObjectURLSpy = vi.fn(() => 'blob:fake-url');
    revokeObjectURLSpy = vi.fn();
    URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURLSpy as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it('creates a Blob URL and clicks an anchor with the Windows-safe filename', () => {
    const profile = buildProfile(new Date('2026-05-07T14:30:00.000Z'));
    const anchorClicks: HTMLAnchorElement[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      anchorClicks.push(this);
    };
    try {
      downloadProfileFile(profile, document, new Date('2026-05-07T14:30:00.000Z'));
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }

    expect(createObjectURLSpy).toHaveBeenCalledOnce();
    expect(anchorClicks).toHaveLength(1);
    expect(anchorClicks[0].download).toBe('lingua-profile-2026-05-07T14-30-00.json');
    expect(anchorClicks[0].href).toContain('blob:fake-url');
  });
});
