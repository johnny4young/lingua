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
import { getPendingSessionRestoreTabCount, useSessionStore } from '../stores/sessionStore';
import { useSnippetsStore } from '../stores/snippetsStore';
import {
  useUIStore,
  type StatusNoticeAction,
  type StatusNoticeDismissMode,
} from '../stores/uiStore';
import type { Language } from '../types/language';
import { emitCommand } from '../stores/commandBus';
import type { TelemetryTrack } from './useTelemetry';

/**
 * internal Onboarding Choreography implementation.
 *
 * Three persisted one-shot flags drive a silent three-step welcome
 * sequence whose goal is "a fresh user reaches their first successful
 * run in under 90 seconds":
 *
 *   1. **Welcome seed** — when no tabs survived `restoreSession` and
 *      `hasCompletedOnboardingWelcome !== true` (or the persisted
 *      `onboardingWelcomeSeedVersion` is older than the current
 *      `SEEDED_SCRATCHPAD_VERSION` — implementation note), inject a pre-seeded
 *      JavaScript scratchpad so the editor is never empty on first
 *      open.
 *
 *   2. **First successful run** — subscribe to the execution-history
 *      store; the first time an `ok` entry lands and the flag is
 *      still false, fire a success toast with a single "Save as
 *      snippet" CTA (implementation note's `StatusNotice.actions` field). The
 *      CTA calls `useSnippetsStore.addSnippet({label: activeTab.name,
 *      ...})` directly (implementation note — no naming modal) and the snippet's
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
 * The lightweight gate short-circuits safe-mode boot (`?safe-mode=1`) so a
 * recovery cycle never runs user-driven IO (snippet writes, tab
 * creation). The gate is also held on `sessionRestoreReady` (caller
 * passes the same readiness flag that gates `useShareLinkBoot`) so a
 * legitimate restored session always wins over the seed.
 */
export interface StartOnboardingChoreographyOptions {
  readonly track: TelemetryTrack;
}

/**
 * Arm the onboarding subscriptions after the lightweight startup gate decides
 * at least one persisted stage still needs work. Synchronous replay closes the
 * race where a welcome scratchpad runs before this deferred module arrives.
 */
export function startOnboardingChoreography({
  track,
}: StartOnboardingChoreographyOptions): () => void {
  seedWelcomeIfNeeded();

  const initialEntries = useExecutionHistoryStore.getState().entries;
  const initialEntry = initialEntries[initialEntries.length - 1];
  if (initialEntry && initialEntry.status === 'ok') {
    handleFirstSuccessfulRun(track, initialEntry.language);
  }
  const unsubHistory = useExecutionHistoryStore.subscribe((state, prev) => {
    if (state.entries === prev.entries) return;
    const latest = state.entries[state.entries.length - 1];
    if (!latest || latest.status !== 'ok') return;
    handleFirstSuccessfulRun(track, latest.language);
  });

  const initialConsoleEntries = useConsoleStore.getState().entries;
  const initialConsoleEntry = initialConsoleEntries[initialConsoleEntries.length - 1];
  if (
    initialConsoleEntry &&
    initialConsoleEntry.type !== 'error' &&
    typeof initialConsoleEntry.executionTime === 'number'
  ) {
    handleFirstSuccessfulRun(track, initialConsoleEntry.language ?? 'javascript');
  }
  const unsubConsole = useConsoleStore.subscribe((state, prev) => {
    if (state.entries === prev.entries) return;
    if (state.entries.length <= prev.entries.length) return;
    const latest = state.entries[state.entries.length - 1];
    if (!latest || latest.type === 'error') return;
    if (typeof latest.executionTime !== 'number') return;
    handleFirstSuccessfulRun(track, latest.language ?? 'javascript');
  });

  let lastSnippetCount = useSnippetsStore.getState().snippets.length;
  if (lastSnippetCount > 0) {
    handleFirstSnippetSave(track);
  }
  const unsubSnippets = useSnippetsStore.subscribe(state => {
    const next = state.snippets.length;
    const previous = lastSnippetCount;
    lastSnippetCount = next;
    if (next > previous) {
      handleFirstSnippetSave(track);
    }
  });

  return () => {
    unsubHistory();
    unsubConsole();
    unsubSnippets();
  };
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
  if (
    settings.restoreSessionMode === 'ask' &&
    (getPendingSessionRestoreTabCount() > 0 || useSessionStore.getState().savedTabs.length > 0)
  ) {
    // Ask-mode means a previous-session snapshot exists but the user has not
    // chosen whether to surface it. Do not seed the welcome scratchpad here:
    // that would schedule autosave and replace the very snapshot the restore
    // prompt/palette are offering.
    return;
  }

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

function handleFirstSuccessfulRun(track: TelemetryTrack, language: string): void {
  const settings = useSettingsStore.getState();
  if (settings.hasCompletedOnboardingFirstRun) return;
  // Lock first so a rapid double-fire (two history entries before the
  // store re-tick) can't push two toasts.
  settings.markOnboardingFirstRunCompleted();

  track('onboarding.first_run_completed', { language });

  const saveAction: StatusNoticeAction = {
    labelKey: 'onboarding.firstRun.cta',
    onClick: () => {
      // implementation note — save the active tab with its current name, no
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
    // implementation note — `'high'` priority guarantees this
    // toast cannot be clobbered by any `'normal'` notice push
    // (the implicit default for 134 existing callers). Surfaced by
    // the implementation reviewer pass after a boot-time notice was
    // observed displacing the first-run toast within ~600 ms.
    priority: 'high',
    // implementation note — production diagnostic when the
    // priority saves the toast. Tells us how often the new field
    // does real work in the wild.
    onSurvived: () => {
      track('onboarding.toast_clobbered', {
        outstandingStage: 'first_run',
      });
    },
    onDismiss: (mode: StatusNoticeDismissMode) => {
      track('onboarding.toast_dismissed', {
        stage: 'first_run',
        dismissMode: mode,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Stage 3 — first snippet save
// ---------------------------------------------------------------------------

function handleFirstSnippetSave(track: TelemetryTrack): void {
  const settings = useSettingsStore.getState();
  if (settings.hasCompletedOnboardingFirstSnippet) return;
  settings.markOnboardingFirstSnippetCompleted();

  track('onboarding.first_snippet_saved');

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform);
  const shortcut = isMac ? 'Cmd+Shift+P' : 'Ctrl+Shift+P';

  const openAction: StatusNoticeAction = {
    labelKey: 'onboarding.firstSnippet.cta',
    onClick: () => {
      // Ask App's overlay owner to open snippets without reaching
      // into its hooks.
      emitCommand('overlay.openSnippets');
    },
  };

  useUIStore.getState().pushStatusNotice({
    tone: 'info',
    messageKey: 'onboarding.firstSnippet.message',
    // implementation note — same priority rationale as the
    // first-run toast above; the library-tip toast must survive any
    // normal-tier notice push for the ~6 s the user needs to read
    // it.
    priority: 'high',
    // implementation note — clobber-attempt telemetry.
    onSurvived: () => {
      track('onboarding.toast_clobbered', {
        outstandingStage: 'first_snippet',
      });
    },
    values: { shortcut },
    actions: [openAction],
    onDismiss: (mode: StatusNoticeDismissMode) => {
      track('onboarding.toast_dismissed', {
        stage: 'first_snippet',
        dismissMode: mode,
      });
    },
  });
}
