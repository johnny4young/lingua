import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SEEDED_SCRATCHPAD_LANGUAGE,
  SEEDED_SCRATCHPAD_NAME,
  SEEDED_SCRATCHPAD_SOURCE,
  SEEDED_SCRATCHPAD_VERSION,
} from '../onboarding/seedScratchpad';
import { useConsoleStore } from '../stores/consoleStore';
import { createDefaultTab, getActiveTab, useEditorStore } from '../stores/editorStore';
import { useExecutionHistoryStore } from '../stores/executionHistoryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSnippetsStore } from '../stores/snippetsStore';
import {
  useUIStore,
  type StatusNoticeAction,
  type StatusNoticeDismissMode,
} from '../stores/uiStore';
import { trackEvent } from '../utils/telemetry';
import { isSafeMode } from '../utils/safeBoot';
import type { Language } from '../types';

/**
 * RL-101 Onboarding Choreography Slice 1.
 *
 * Three persisted one-shot flags drive a silent three-step welcome
 * sequence whose goal is "a fresh user reaches their first successful
 * run in under 90 seconds":
 *
 *   1. **Welcome seed** — when no tabs survived `restoreSession` and
 *      `hasCompletedOnboardingWelcome !== true` (or the persisted
 *      `onboardingWelcomeSeedVersion` is older than the current
 *      `SEEDED_SCRATCHPAD_VERSION` — fold E), inject a pre-seeded
 *      JavaScript scratchpad so the editor is never empty on first
 *      open.
 *
 *   2. **First successful run** — subscribe to the execution-history
 *      store; the first time an `ok` entry lands and the flag is
 *      still false, fire a success toast with a single "Save as
 *      snippet" CTA (fold A's `StatusNotice.actions` field). The
 *      CTA calls `useSnippetsStore.addSnippet({label: activeTab.name,
 *      ...})` directly (fold C — no naming modal) and the snippet's
 *      arrival drives stage 3.
 *
 *   3. **First snippet save** — subscribe to the snippets-store
 *      length; the first time it transitions from 0 → 1+ (whether
 *      via the CTA above or any other surface) and the flag is
 *      still false, fire an info toast pointing to the snippets
 *      library and Command Palette discovery path (Cmd+Shift+P /
 *      Ctrl+Shift+P).
 *
 * All three telemetry events (`onboarding.first_run_completed`,
 * `onboarding.first_snippet_saved`, `onboarding.toast_dismissed`) are
 * closed-enum and mirrored on update-server.
 *
 * Safe-mode boot (`?safe-mode=1`) short-circuits the entire hook so a
 * recovery cycle never runs user-driven IO (snippet writes, tab
 * creation). The hook is gated on `sessionRestoreReady` (caller
 * passes the same readiness flag that gates `useShareLinkBoot`) so a
 * legitimate restored session always wins over the seed.
 */
export interface UseOnboardingChoreographyOptions {
  /**
   * When `false`, the hook does nothing on mount and skips the
   * execution-history / snippets subscriptions. Caller (App.tsx)
   * flips this `true` once `restoreSession()` resolves so a real
   * restored session always beats the seed.
   */
  readonly enabled?: boolean;
}

export function useOnboardingChoreography({
  enabled = true,
}: UseOnboardingChoreographyOptions = {}): void {
  // Re-mount on locale flip so toasts surface in the new language
  // without a reload. Same pattern as `useShareLinkBoot`.
  const { i18n } = useTranslation();

  // We use refs because the effect deliberately runs only once on
  // mount and we sample store state via `getState()`/`subscribe()`
  // instead of re-rendering on every store tick.
  const armedRef = useRef(false);

  useEffect(() => {
    if (!enabled || isSafeMode() || armedRef.current) return;
    armedRef.current = true;

    // ---- Stage 1: welcome seed ---------------------------------------
    seedWelcomeIfNeeded();

    // ---- Stage 2: first successful run -------------------------------
    // The Scratchpad workflow can produce the first auto-run BEFORE
    // this effect mounts (the welcome seed lands a tab, the auto-run
    // gate fires, the runner records an `'ok'` entry, all before we
    // subscribe). Zustand's `subscribe()` only delivers later updates,
    // so without this synchronous check the first-run toast would
    // never fire for the seeded scratchpad. Replay the newest entry
    // on mount; the store keeps entries oldest -> newest, so read the
    // tail. The `markOnboardingFirstRunCompleted()` guard inside
    // `handleFirstSuccessfulRun` keeps it from double-firing if the
    // subscription also delivers the same entry on the next tick.
    const initialEntries = useExecutionHistoryStore.getState().entries;
    const initialEntry = initialEntries[initialEntries.length - 1];
    if (initialEntry && initialEntry.status === 'ok') {
      handleFirstSuccessfulRun(initialEntry.language);
    }
    const unsubHistory = useExecutionHistoryStore.subscribe((state, prev) => {
      if (state.entries === prev.entries) return;
      const latest = state.entries[state.entries.length - 1];
      if (!latest || latest.status !== 'ok') return;
      handleFirstSuccessfulRun(latest.language);
    });

    // `useExecutionHistoryStore.record()` only fires for manual runs
    // (Cmd+Enter / Run button) via `executeTabManually`. Scratchpad
    // auto-runs — the default mode for the welcome seed — never reach
    // that store, so without a parallel subscription the first-run
    // toast would never fire for a fresh user who never explicitly
    // pressed Run. The console store IS pushed by both paths, and the
    // runners always tag the LAST entry of a successful run with
    // `executionTime` (the per-run latency badge). Treat the first
    // `executionTime`-bearing non-error entry as "run completed" for
    // the choreography — false positives are not possible because
    // only the runners ever set `executionTime`.
    const initialConsoleEntries = useConsoleStore.getState().entries;
    const initialConsoleEntry =
      initialConsoleEntries[initialConsoleEntries.length - 1];
    if (
      initialConsoleEntry &&
      initialConsoleEntry.type !== 'error' &&
      typeof initialConsoleEntry.executionTime === 'number'
    ) {
      handleFirstSuccessfulRun(initialConsoleEntry.language ?? 'javascript');
    }
    const unsubConsole = useConsoleStore.subscribe((state, prev) => {
      if (state.entries === prev.entries) return;
      if (state.entries.length <= prev.entries.length) return;
      const latest = state.entries[state.entries.length - 1];
      if (!latest) return;
      if (latest.type === 'error') return;
      if (typeof latest.executionTime !== 'number') return;
      handleFirstSuccessfulRun(latest.language ?? 'javascript');
    });

    // ---- Stage 3: first snippet save ---------------------------------
    let lastSnippetCount = useSnippetsStore.getState().snippets.length;
    const unsubSnippets = useSnippetsStore.subscribe((state) => {
      const next = state.snippets.length;
      const previous = lastSnippetCount;
      lastSnippetCount = next;
      if (next > previous) {
        handleFirstSnippetSave();
      }
    });

    return () => {
      unsubHistory();
      unsubConsole();
      unsubSnippets();
      armedRef.current = false;
    };
    // i18n.language is intentionally in deps so a locale flip
    // re-mounts the effect; the per-mount armed-ref guard prevents
    // double seeds.
  }, [enabled, i18n.language]);
}

// ---------------------------------------------------------------------------
// Stage 1 — welcome seed
// ---------------------------------------------------------------------------

function seedWelcomeIfNeeded(): void {
  const settings = useSettingsStore.getState();
  const editor = useEditorStore.getState();
  if (editor.tabs.length > 0) {
    // Anything in the workspace (restored session, share-link import,
    // user-clicked template) beats the seed. Don't touch the flag —
    // a future fresh install will re-evaluate.
    return;
  }
  const onCurrentVersion =
    settings.hasCompletedOnboardingWelcome &&
    settings.onboardingWelcomeSeedVersion >= SEEDED_SCRATCHPAD_VERSION;
  if (onCurrentVersion) return;

  const base = createDefaultTab(SEEDED_SCRATCHPAD_LANGUAGE as Language);
  editor.addTab({
    ...base,
    name: SEEDED_SCRATCHPAD_NAME,
    content: SEEDED_SCRATCHPAD_SOURCE,
  });
  settings.markOnboardingWelcomeCompleted(SEEDED_SCRATCHPAD_VERSION);
}

// ---------------------------------------------------------------------------
// Stage 2 — first successful run
// ---------------------------------------------------------------------------

function handleFirstSuccessfulRun(language: string): void {
  const settings = useSettingsStore.getState();
  if (settings.hasCompletedOnboardingFirstRun) return;
  // Lock first so a rapid double-fire (two history entries before the
  // store re-tick) can't push two toasts.
  settings.markOnboardingFirstRunCompleted();

  void trackEvent('onboarding.first_run_completed', { language });

  const saveAction: StatusNoticeAction = {
    labelKey: 'onboarding.firstRun.cta',
    onClick: () => {
      // Fold C — save the active tab with its current name, no
      // modal prompt. Falls back to a generic name if the tab is
      // somehow unnamed (defensive — the seeded scratchpad is
      // always named).
      const editor = useEditorStore.getState();
      const activeTab = getActiveTab(editor) ?? editor.tabs[0] ?? null;
      if (!activeTab) return;
      const snippetId = useSnippetsStore.getState().addSnippet({
        label: activeTab.name || 'untitled',
        description: '',
        language: activeTab.language,
        code: activeTab.content,
      });
      if (snippetId === null) {
        // `addSnippet` already pushed the Free-tier upsell notice;
        // do not overwrite it with a generic success.
        return;
      }
      // The snippets-store subscription owns the next visible toast:
      // `onboarding.firstSnippet.message` includes the saved state and
      // the library CTA. Pushing another generic success here would
      // immediately replace the onboarding tip this CTA is meant to
      // unlock.
    },
  };

  useUIStore.getState().pushStatusNotice({
    tone: 'success',
    messageKey: 'onboarding.firstRun.message',
    actions: [saveAction],
    // RL-101 Slice 1.5 fold B — `'high'` priority guarantees this
    // toast cannot be clobbered by any `'normal'` notice push
    // (the implicit default for 134 existing callers). Surfaced by
    // the Slice 1 reviewer pass after a boot-time notice was
    // observed displacing the first-run toast within ~600 ms.
    priority: 'high',
    // RL-101 Slice 1.5 fold A — production diagnostic when the
    // priority saves the toast. Tells us how often the new field
    // does real work in the wild.
    onSurvived: () => {
      void trackEvent('onboarding.toast_clobbered', {
        outstandingStage: 'first_run',
      });
    },
    onDismiss: (mode: StatusNoticeDismissMode) => {
      void trackEvent('onboarding.toast_dismissed', {
        stage: 'first_run',
        dismissMode: mode,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Stage 3 — first snippet save
// ---------------------------------------------------------------------------

function handleFirstSnippetSave(): void {
  const settings = useSettingsStore.getState();
  if (settings.hasCompletedOnboardingFirstSnippet) return;
  settings.markOnboardingFirstSnippetCompleted();

  void trackEvent('onboarding.first_snippet_saved');

  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/u.test(navigator.platform);
  const shortcut = isMac ? 'Cmd+Shift+P' : 'Ctrl+Shift+P';

  const openAction: StatusNoticeAction = {
    labelKey: 'onboarding.firstSnippet.cta',
    onClick: () => {
      // Dispatch a window event so AppChrome's overlay state can
      // open snippets without us reaching into its hooks. Mirrors
      // the `lingua-share-link-trigger` cross-component pattern
      // from RL-036.
      window.dispatchEvent(new CustomEvent('lingua-open-snippets-overlay'));
    },
  };

  useUIStore.getState().pushStatusNotice({
    tone: 'info',
    messageKey: 'onboarding.firstSnippet.message',
    // RL-101 Slice 1.5 fold B — same priority rationale as the
    // first-run toast above; the library-tip toast must survive any
    // normal-tier notice push for the ~6 s the user needs to read
    // it.
    priority: 'high',
    // RL-101 Slice 1.5 fold A — clobber-attempt telemetry.
    onSurvived: () => {
      void trackEvent('onboarding.toast_clobbered', {
        outstandingStage: 'first_snippet',
      });
    },
    values: { shortcut },
    actions: [openAction],
    onDismiss: (mode: StatusNoticeDismissMode) => {
      void trackEvent('onboarding.toast_dismissed', {
        stage: 'first_snippet',
        dismissMode: mode,
      });
    },
  });
}
