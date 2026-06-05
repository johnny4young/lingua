import type { SettingsState } from '../types';
import type { SettingsSet } from './settingsStoreContext';

/**
 * RL-129 fold B — session/onboarding setter factory for the settings store.
 * Bundles restore-session, the onboarding reset + completion-mark setters,
 * app language, last-seen-version, tour flags, and the SQL-workspace
 * row-display-limit + query-timeout setters. Extracted verbatim from
 * `settingsStore.ts`. `set`-only — none of these setters read `get()`.
 */
export function createSessionActions(
  set: SettingsSet
): Pick<
  SettingsState,
  | 'toggleRestoreSession'
  | 'resetOnboardingWelcome'
  | 'resetOnboardingFirstRun'
  | 'resetOnboardingFirstSnippet'
  | 'markOnboardingWelcomeCompleted'
  | 'markOnboardingFirstRunCompleted'
  | 'markOnboardingFirstSnippetCompleted'
  | 'setLanguage'
  | 'setLastSeenVersion'
  | 'setHasCompletedTour'
  | 'setSuppressTourAutoStart'
  | 'setSqlWorkspaceRowDisplayLimit'
  | 'setSqlWorkspaceQueryTimeoutMs'
> {
  return {
    toggleRestoreSession: () => set((s) => ({ restoreSession: !s.restoreSession })),
    // RL-101 Slice 1 — three reset setters. Flip the corresponding
    // flag back to `false` so the next welcome-seed, first-run, or
    // first-snippet event re-arms the toast. Settings → General
    // wires these to the reset toggles; the palette commands
    // (fold G) and the Mod+Shift+W shortcut (fold D) reuse them.
    resetOnboardingWelcome: () =>
      set({
        hasCompletedOnboardingWelcome: false,
        // Resetting also clears the seed-version tracker so the
        // next boot re-applies the latest seed even if the user is
        // already on the current `SEEDED_SCRATCHPAD_VERSION`.
        onboardingWelcomeSeedVersion: 0,
      }),
    resetOnboardingFirstRun: () =>
      set({ hasCompletedOnboardingFirstRun: false }),
    resetOnboardingFirstSnippet: () =>
      set({ hasCompletedOnboardingFirstSnippet: false }),
    // Stage completion setters — called by `useOnboardingChoreography`
    // after each fired event so the toast never repeats. Idempotent.
    markOnboardingWelcomeCompleted: (seedVersion) =>
      set({
        hasCompletedOnboardingWelcome: true,
        onboardingWelcomeSeedVersion: seedVersion,
      }),
    markOnboardingFirstRunCompleted: () =>
      set({ hasCompletedOnboardingFirstRun: true }),
    markOnboardingFirstSnippetCompleted: () =>
      set({ hasCompletedOnboardingFirstSnippet: true }),
    setLanguage: (language) => set({ language }),
    setLastSeenVersion: (lastSeenVersion) => set({ lastSeenVersion }),
    setHasCompletedTour: (hasCompletedTour) => set({ hasCompletedTour }),
    setSuppressTourAutoStart: (suppressTourAutoStart) => set({ suppressTourAutoStart }),
    setSqlWorkspaceRowDisplayLimit: (value) =>
      set((state) => {
        // Clamp unknown values to the default 1000. Closed enum keeps
        // the toggle drop-down honest; this guard catches anyone
        // calling the setter directly with a stray number.
        const allowed: ReadonlySet<number> = new Set([100, 500, 1000, 5000]);
        const next = allowed.has(value) ? value : 1000;
        if (state.sqlWorkspaceRowDisplayLimit === next) return state;
        return { sqlWorkspaceRowDisplayLimit: next };
      }),
    setSqlWorkspaceQueryTimeoutMs: (value) =>
      set((state) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          return { sqlWorkspaceQueryTimeoutMs: 30_000 };
        }
        // Min 1 s, max 5 min — same bound the runtime enforces.
        const next = Math.min(Math.max(1_000, Math.floor(value)), 5 * 60 * 1000);
        if (state.sqlWorkspaceQueryTimeoutMs === next) return state;
        return { sqlWorkspaceQueryTimeoutMs: next };
      }),
  };
}
