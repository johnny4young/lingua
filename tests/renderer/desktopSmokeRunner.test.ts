import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEEDED_SCRATCHPAD_VERSION } from '../../src/renderer/onboarding/seedScratchpadMetadata';
import { prepareDesktopSmokeWorkspace } from '../../src/renderer/hooks/desktopSmokeRunner';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';

describe('desktop smoke workspace preparation', () => {
  const initialSettings = useSettingsStore.getState();
  const initialUi = useUIStore.getState();
  const noticeDismiss = vi.fn();

  beforeEach(() => {
    noticeDismiss.mockReset();
    localStorage.clear();
    useSettingsStore.setState(initialSettings, true);
    useUIStore.setState(initialUi, true);
    useSettingsStore.setState({
      telemetryConsent: 'unset',
      hasCompletedOnboardingWelcome: false,
      hasCompletedOnboardingFirstRun: false,
      hasCompletedOnboardingFirstSnippet: false,
      onboardingWelcomeSeedVersion: 0,
      nativeExecutionAcknowledged: false,
    });
    useUIStore.getState().pushStatusNotice({
      tone: 'success',
      messageKey: 'onboarding.firstRun.message',
      onDismiss: noticeDismiss,
    });
  });

  afterEach(() => {
    useSettingsStore.setState(initialSettings, true);
    useUIStore.setState(initialUi, true);
    localStorage.clear();
  });

  it('uses a private, onboarding-free profile with unobstructed output chrome', () => {
    prepareDesktopSmokeWorkspace();

    expect(useSettingsStore.getState()).toMatchObject({
      telemetryConsent: 'declined',
      hasCompletedOnboardingWelcome: true,
      hasCompletedOnboardingFirstRun: true,
      hasCompletedOnboardingFirstSnippet: true,
      onboardingWelcomeSeedVersion: SEEDED_SCRATCHPAD_VERSION,
      nativeExecutionAcknowledged: true,
      layoutPreset: 'horizontal',
    });
    expect(useUIStore.getState()).toMatchObject({
      sidebarVisible: false,
      consoleVisible: true,
      statusNotice: null,
    });
    expect(noticeDismiss).toHaveBeenCalledOnce();
    expect(noticeDismiss).toHaveBeenCalledWith('auto');
  });
});
