import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOnboardingChoreography } from '../../../src/renderer/hooks/useOnboardingChoreography';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';
import { useEditorStore } from '../../../src/renderer/stores/editorStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';
import { useSnippetsStore } from '../../../src/renderer/stores/snippetsStore';
import { useExecutionHistoryStore } from '../../../src/renderer/stores/executionHistoryStore';
import {
  SEEDED_SCRATCHPAD_NAME,
  SEEDED_SCRATCHPAD_VERSION,
} from '../../../src/renderer/onboarding/seedScratchpad';

vi.mock('../../../src/renderer/utils/safeBoot', () => ({
  isSafeMode: () => false,
}));

vi.mock('../../../src/renderer/utils/telemetry', () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

async function resetStores() {
  await act(async () => {
    useSettingsStore.setState({
      hasCompletedOnboardingWelcome: false,
      hasCompletedOnboardingFirstRun: false,
      hasCompletedOnboardingFirstSnippet: false,
      onboardingWelcomeSeedVersion: 0,
    });
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useUIStore.setState({ statusNotice: null });
    useSnippetsStore.setState({ snippets: [] });
    useExecutionHistoryStore.setState({ entries: [] });
  });
}

describe('useOnboardingChoreography', () => {
  beforeEach(async () => {
    await resetStores();
  });

  it('seeds the welcome scratchpad on fresh install and flips the flag', async () => {
    renderHook(() => useOnboardingChoreography({ enabled: true }));
    await waitFor(() => {
      const tabs = useEditorStore.getState().tabs;
      expect(tabs.length).toBe(1);
      expect(tabs[0]?.name).toBe(SEEDED_SCRATCHPAD_NAME);
    });
    expect(
      useSettingsStore.getState().hasCompletedOnboardingWelcome
    ).toBe(true);
    expect(useSettingsStore.getState().onboardingWelcomeSeedVersion).toBe(
      SEEDED_SCRATCHPAD_VERSION
    );
  });

  it('does NOT seed when tabs already exist (restored session wins)', async () => {
    act(() => {
      useEditorStore.setState({
        tabs: [
          {
            id: 'existing',
            name: 'restored.js',
            content: '',
            language: 'javascript',
            runtimeMode: 'worker',
            workflowMode: 'scratchpad',
            autoLogEnabled: false,
            stdinBuffer: '',
            isDirty: false,
          } as never,
        ],
        activeTabId: 'existing',
      });
    });
    renderHook(() => useOnboardingChoreography({ enabled: true }));
    expect(useEditorStore.getState().tabs.length).toBe(1);
    expect(useEditorStore.getState().tabs[0]?.name).toBe('restored.js');
    expect(useSettingsStore.getState().hasCompletedOnboardingWelcome).toBe(
      false
    );
  });

  it('does NOT seed when enabled is false', () => {
    renderHook(() => useOnboardingChoreography({ enabled: false }));
    expect(useEditorStore.getState().tabs.length).toBe(0);
    expect(useSettingsStore.getState().hasCompletedOnboardingWelcome).toBe(
      false
    );
  });

  it('re-seeds when persisted seed version is older than current', async () => {
    act(() => {
      useSettingsStore.setState({
        hasCompletedOnboardingWelcome: true,
        onboardingWelcomeSeedVersion: 0,
      });
    });
    renderHook(() => useOnboardingChoreography({ enabled: true }));
    await waitFor(() => {
      expect(useEditorStore.getState().tabs.length).toBe(1);
    });
    expect(useSettingsStore.getState().onboardingWelcomeSeedVersion).toBe(
      SEEDED_SCRATCHPAD_VERSION
    );
  });

  it('does NOT re-seed when persisted seed version matches', () => {
    act(() => {
      useSettingsStore.setState({
        hasCompletedOnboardingWelcome: true,
        onboardingWelcomeSeedVersion: SEEDED_SCRATCHPAD_VERSION,
      });
    });
    renderHook(() => useOnboardingChoreography({ enabled: true }));
    expect(useEditorStore.getState().tabs.length).toBe(0);
  });

  it('fires the first-run toast with a CTA action when a success history entry arrives', async () => {
    renderHook(() => useOnboardingChoreography({ enabled: true }));
    await waitFor(() => {
      expect(useEditorStore.getState().tabs.length).toBe(1);
    });
    act(() => {
      useExecutionHistoryStore.getState().record({
        language: 'javascript',
        status: 'ok',
        durationMs: 42,
      });
    });
    await waitFor(() => {
      const notice = useUIStore.getState().statusNotice;
      expect(notice?.messageKey).toBe('onboarding.firstRun.message');
      expect(notice?.actions?.[0]?.labelKey).toBe('onboarding.firstRun.cta');
    });
    expect(useSettingsStore.getState().hasCompletedOnboardingFirstRun).toBe(
      true
    );
  });

  it('save-as-snippet CTA leaves the first-snippet library tip visible', async () => {
    renderHook(() => useOnboardingChoreography({ enabled: true }));
    await waitFor(() => {
      expect(useEditorStore.getState().tabs.length).toBe(1);
    });
    act(() => {
      useExecutionHistoryStore.getState().record({
        language: 'javascript',
        status: 'ok',
        durationMs: 42,
      });
    });
    await waitFor(() => {
      expect(useUIStore.getState().statusNotice?.messageKey).toBe(
        'onboarding.firstRun.message'
      );
    });

    act(() => {
      useUIStore.getState().statusNotice?.actions?.[0]?.onClick();
    });

    await waitFor(() => {
      expect(useSnippetsStore.getState().snippets[0]?.label).toBe(
        SEEDED_SCRATCHPAD_NAME
      );
      expect(useUIStore.getState().statusNotice?.messageKey).toBe(
        'onboarding.firstSnippet.message'
      );
    });
  });

  it('does NOT fire the first-run toast for an error-status history entry', async () => {
    renderHook(() => useOnboardingChoreography({ enabled: true }));
    await waitFor(() => {
      expect(useEditorStore.getState().tabs.length).toBe(1);
    });
    act(() => {
      useExecutionHistoryStore.getState().record({
        language: 'javascript',
        status: 'error',
        durationMs: 5,
      });
    });
    expect(useUIStore.getState().statusNotice).toBeNull();
    expect(useSettingsStore.getState().hasCompletedOnboardingFirstRun).toBe(
      false
    );
  });

  it('fires the first-run toast when a later success follows an earlier error', async () => {
    renderHook(() => useOnboardingChoreography({ enabled: true }));
    await waitFor(() => {
      expect(useEditorStore.getState().tabs.length).toBe(1);
    });
    act(() => {
      useExecutionHistoryStore.getState().record({
        language: 'javascript',
        status: 'error',
        durationMs: 5,
      });
      useExecutionHistoryStore.getState().record({
        language: 'javascript',
        status: 'ok',
        durationMs: 42,
      });
    });
    await waitFor(() => {
      expect(useUIStore.getState().statusNotice?.messageKey).toBe(
        'onboarding.firstRun.message'
      );
    });
    expect(useSettingsStore.getState().hasCompletedOnboardingFirstRun).toBe(
      true
    );
  });

  it('fires the first-snippet toast with shortcut interpolation when snippets grow from 0 to 1', async () => {
    renderHook(() => useOnboardingChoreography({ enabled: true }));
    await waitFor(() => {
      expect(useEditorStore.getState().tabs.length).toBe(1);
    });
    act(() => {
      useSnippetsStore.getState().addSnippet({
        label: 'manual save',
        description: '',
        language: 'javascript',
        code: 'console.log(1)',
      });
    });
    await waitFor(() => {
      const notice = useUIStore.getState().statusNotice;
      expect(notice?.messageKey).toBe('onboarding.firstSnippet.message');
      expect(notice?.values?.shortcut).toMatch(/Shift\+P/u);
    });
    expect(
      useSettingsStore.getState().hasCompletedOnboardingFirstSnippet
    ).toBe(true);
  });

  it('first-snippet toast does NOT re-fire once the flag is true', () => {
    act(() => {
      useSettingsStore.setState({
        hasCompletedOnboardingFirstSnippet: true,
      });
    });
    renderHook(() => useOnboardingChoreography({ enabled: true }));
    act(() => {
      useSnippetsStore.getState().addSnippet({
        label: 'another',
        description: '',
        language: 'javascript',
        code: 'noop',
      });
    });
    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).not.toBe('onboarding.firstSnippet.message');
  });
});
