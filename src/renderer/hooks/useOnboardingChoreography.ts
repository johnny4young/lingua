import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SEEDED_SCRATCHPAD_VERSION } from '../onboarding/seedScratchpadMetadata';
import { useSettingsStore } from '../stores/settingsStore';
import { isSafeMode } from '../utils/safeBoot';
import { useTelemetry } from './useTelemetry';

export interface UseOnboardingChoreographyOptions {
  /** Wait for session restoration so a restored workspace always beats seeding. */
  readonly enabled?: boolean;
}

type OnboardingRuntime = typeof import('./onboardingChoreographyRuntime');
let runtimePromise: Promise<OnboardingRuntime> | null = null;

function loadOnboardingRuntime(): Promise<OnboardingRuntime> {
  runtimePromise ??= import('./onboardingChoreographyRuntime').catch(error => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

function hasPendingOnboardingStage(state: ReturnType<typeof useSettingsStore.getState>): boolean {
  const welcomeComplete =
    state.hasCompletedOnboardingWelcome &&
    state.onboardingWelcomeSeedVersion >= SEEDED_SCRATCHPAD_VERSION;
  return (
    !welcomeComplete ||
    !state.hasCompletedOnboardingFirstRun ||
    !state.hasCompletedOnboardingFirstSnippet
  );
}

/**
 * Keep completed onboarding out of the startup graph. Returning users pay only
 * for this persisted-state predicate; the choreography runtime loads while at
 * least one stage is still actionable and unloads its subscriptions once all
 * stages complete.
 */
export function useOnboardingChoreography({
  enabled = true,
}: UseOnboardingChoreographyOptions = {}): void {
  const { i18n } = useTranslation();
  const { track } = useTelemetry();
  const hasPendingStage = useSettingsStore(hasPendingOnboardingStage);

  useEffect(() => {
    if (!enabled || !hasPendingStage || isSafeMode()) return;

    let active = true;
    let stopRuntime: (() => void) | undefined;

    void loadOnboardingRuntime()
      .then(runtime => {
        if (!active) return;
        stopRuntime = runtime.startOnboardingChoreography({ track });
      })
      .catch(() => {
        // Onboarding is optional boot guidance. Keep startup usable and allow
        // the loader to retry after a locale or persisted-stage change.
      });

    return () => {
      active = false;
      stopRuntime?.();
    };
  }, [enabled, hasPendingStage, i18n.language, track]);
}
