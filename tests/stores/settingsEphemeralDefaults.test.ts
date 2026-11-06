import { afterEach, describe, expect, it } from 'vitest';
import { createInitialSettingsState } from '../../src/renderer/stores/settingsDefaults';

describe('settings defaults with blocked storage', () => {
  afterEach(() => {
    delete document.documentElement.dataset.storage;
  });

  it('runs the one-shot onboarding on a normal first load', () => {
    const state = createInitialSettingsState();
    expect(state.suppressTourAutoStart).toBe(false);
    expect(state.hasCompletedOnboardingFirstRun).toBe(false);
    expect(state.hasCompletedOnboardingFirstSnippet).toBe(false);
  });

  it('skips what would repeat on every load, and keeps the welcome seed', () => {
    document.documentElement.dataset.storage = 'memory';
    const state = createInitialSettingsState();
    expect(state.suppressTourAutoStart).toBe(true);
    expect(state.hasCompletedOnboardingFirstRun).toBe(true);
    expect(state.hasCompletedOnboardingFirstSnippet).toBe(true);
    expect(state.hasCompletedOnboardingWelcome).toBe(false);
  });
});
