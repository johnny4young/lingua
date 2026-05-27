import { useEffect, useEffectEvent, useMemo } from 'react';
import i18next from 'i18next';
import {
  KEYBOARD_SHORTCUTS,
  formatShortcutCombo,
  matchesCombo,
  resolveCombos,
  resolveShortcutDisplayPlatform,
  type ShortcutDefinition,
} from '../data/keyboardShortcuts';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { useUtilityOutputStore } from '../stores/utilityOutputStore';
import { takePendingClipboardApply } from './useClipboardOnFocus';
import { trackEvent } from '../utils/telemetry';
import { isDebugWorkerActive, postDebuggerMessage } from '../runtime/debuggerWorkerBridge';
import { useDebuggerStore } from '../stores/debuggerStore';
import { getActiveEditorCursorLine } from '../runtime/editorAccess';
import { useEditorStore } from '../stores/editorStore';
import { languageSupportsDebugger } from '../utils/languageMeta';

export type AppOverlay =
  | 'none'
  | 'settings'
  | 'palette'
  | 'quick-open'
  | 'search'
  | 'replace'
  | 'go-to-symbol'
  | 'utilities'
  | 'snippets'
  | 'whats-new'
  | 'keyboard-shortcuts'
  | 'project-templates'
  // RL-094 Slice 2 — capsule import preview + confirmation modal.
  // Mounted by App.tsx + opened via Mod+Shift+Y, Settings → Account
  // → Run Capsules → Import, and command palette `action-import-capsule`.
  | 'capsule-import'
  // RL-100 Slice 1 — global Import overlay (cURL → HTTP request
  // adapter Slice 1; `.ipynb` Slice 2; Bruno/Postman Slice 3).
  // Opened via Mod+Alt+I and command palette
  // `action-open-import-overlay`.
  | 'import-preview';

interface UseGlobalShortcutsOptions {
  isRunning: boolean;
  run: () => void | Promise<void>;
  stop: () => void;
  saveActiveTab: () => void | Promise<void>;
  saveActiveTabAs: () => void | Promise<void>;
  openFileFromDisk: () => void | Promise<void>;
  closeActiveTab: () => void | Promise<void>;
  toggleSidebar: () => void;
  toggleConsole: () => void;
  overlay: AppOverlay;
  toggleOverlay: (overlay: Exclude<AppOverlay, 'none'>) => void;
  openDeveloperUtilities: () => void;
  closeOverlay: () => void;
  /**
   * RL-097 Slice 1 — toggle the HTTP workspace bottom-panel tab via
   * Mod+Shift+K. Toggle (not just open) so a second press hides it.
   * Caller wires this to `useUIStore.openBottomPanel('http')` /
   * `setActiveBottomPanel('console')` per the surface convention.
   */
  toggleHttpWorkspace: () => void;
  /**
   * RL-097 Slice 2 — toggle the SQL workspace bottom-panel tab via
   * Mod+Alt+S. Mirror of `toggleHttpWorkspace`. Caller wires this
   * to `useUIStore.openBottomPanel('sql')` /
   * `setActiveBottomPanel('console')`.
   */
  toggleSqlWorkspace: () => void;
  /**
   * RL-099 Slice 1 fold A — open the Developer Utilities overlay
   * with the Pipelines panel preselected via Mod+Shift+G. Caller
   * wires this to `handleOpenDeveloperUtility('utility-pipelines')`.
   */
  openUtilityPipelines: () => void;
  /**
   * RL-100 Slice 1 fold A — open the global Import overlay via
   * Mod+Alt+I. Caller wires this to `openOverlay('import-preview')`.
   */
  openImportOverlay: () => void;
  /**
   * RL-019 Slice 1 fold D — cycle the active JS/TS tab through the
   * implemented runtime modes. RL-019 now ships all three modes:
   * Worker, Node, and Browser preview.
   * Caller is responsible for the non-JS/TS guard (the helper in
   * `App.tsx` checks `languageHasRuntimeModes` before calling).
   */
  cycleRuntimeMode: () => void;
  /**
   * RL-020 Slice 2 fold A — cycle the active tab's workflow mode
   * (Run → Debug → Scratchpad → Run) while skipping unsupported
   * segments for the language. Caller in `App.tsx` resolves the
   * active tab + supported subset and calls
   * `setTabWorkflowMode`.
   */
  cycleWorkflowMode: () => void;
  /**
   * RL-020 Slice 4 fold B — toggle the per-tab Recent Runs popover
   * in the result-panel header. Dispatched via the
   * `recentRunsPopoverBridge` module so the handler does not need
   * to pipe a ref through the renderer tree. When no pill is
   * mounted (Free tier, view-only tab, empty per-tab history) the
   * caller surfaces a localized status notice instead.
   */
  toggleRecentRunsPopover: () => void;
  /**
   * RL-020 Slice 8 fold D — toggle the Compare panel on the active
   * tab via the editor store's `setTabCompareEnabled`. No-op when
   * there's no comparator snapshot (the toggle button gate already
   * mirrors this). Caller in `App.tsx` reads the active tab + the
   * result store snapshot, decides whether to fire, and surfaces a
   * localized notice when the shortcut is pressed without a
   * comparator (so the user never gets a silent no-op).
   */
  toggleCompareWithSnapshot: () => void;
  /**
   * RL-020 Slice 9 fold C — toggle the Variables panel on the active
   * tab via the editor store's `setTabVariableInspectorEnabled`.
   * No-op + localized notice when there is no scope snapshot.
   */
  toggleVariableInspector: () => void;
  /**
   * RL-093 Slice 3 — toggles the bottom Stdin drawer for the active
   * tab. No-op when the active language doesn't support stdin (Stdin
   * is currently JS / TS / Python only) or the `showStdinPanel` user
   * setting is off.
   */
  toggleStdinPanel: () => void;
  /**
   * RL-093 Slice 3 — clears `actionPillPosition` and
   * `variablesCardPosition` in uiStore, sending both floating
   * surfaces back to their synchronous default positions. Useful when
   * a saved coordinate landed off-screen after a window-size change.
   */
  resetFloatingPositions: () => void;
  /**
   * RL-093 Slice 3 fold D — flip the variable inspector surface
   * between floating card and bottom panel tab. Power-user shortcut
   * that mirrors the Settings dropdown.
   */
  toggleVariableInspectorSurface: () => void;
  /**
   * RL-094 Slice 1.5 fold A — export the latest captured RunCapsule
   * to the clipboard via the result-panel-export trigger. No-op
   * when `latestCapsule()` returns null (the App layer reads the
   * store + pushes a `noCapsule` status notice instead of silently
   * dropping the keypress).
   */
  exportLatestCapsule: () => void;
  /**
   * RL-036 Phase A1 fold D — copy a share-link for the active tab.
   * Dispatches the `lingua-share-link-trigger` event so the modal
   * owner (`<ShareLinkController>`) runs the same flow as a button
   * click, with `trigger: 'shortcut'` for telemetry attribution.
   * No-op when no tab is active.
   */
  copyShareLink: () => void;
  /**
   * RL-101 Slice 1 fold D — replay the onboarding choreography by
   * resetting all three stage flags + the seed-version tracker, then
   * pushing a confirmation notice. The next mount of
   * `useOnboardingChoreography` re-seeds the welcome scratchpad and
   * re-arms both toasts.
   */
  replayOnboarding: () => void;
  /**
   * RL-025 Slice A fold C — focus the bottom-panel Dependencies tab
   * for the active file. No-op + status notice when there are no
   * detected dependencies (the tab is hidden) or when the master
   * toggle is OFF.
   */
  showDependenciesPanel: () => void;
}

type ShortcutHandler = (event: KeyboardEvent) => void;

/**
 * Actions dispatched when a catalogued shortcut matches. Keeping this keyed
 * by the catalog's id (instead of hardcoded combo branches) is what lets
 * per-user overrides work without a second rebinding path. The Escape /
 * overlay-close case is handled separately because it has overlay-aware
 * gating that the generic matcher doesn't need to know about.
 */
function buildActionMap(options: UseGlobalShortcutsOptions): Record<string, ShortcutHandler> {
  const { run, stop, isRunning } = options;
  return {
    'run-toggle': () => {
      if (isRunning) stop();
      else void run();
    },
    'run-cycle-runtime-mode': () => options.cycleRuntimeMode(),
    'run-cycle-workflow-mode': () => options.cycleWorkflowMode(),
    'run-toggle-recent-runs': () => options.toggleRecentRunsPopover(),
    'run-toggle-compare-snapshot': () => options.toggleCompareWithSnapshot(),
    'run-toggle-variable-inspector': () => options.toggleVariableInspector(),
    'editor-toggle-stdin-panel': () => options.toggleStdinPanel(),
    'run-export-capsule': () => options.exportLatestCapsule(),
    'run-copy-share-link': () => options.copyShareLink(),
    'onboarding-replay': () => options.replayOnboarding(),
    'view-show-dependencies': () => options.showDependenciesPanel(),
    'ui-reset-floating-positions': () => options.resetFloatingPositions(),
    'view-toggle-variable-inspector-surface': () =>
      options.toggleVariableInspectorSurface(),
    'file-save': () => {
      void options.saveActiveTab();
    },
    'file-save-as': () => {
      void options.saveActiveTabAs();
    },
    'file-open': () => {
      void options.openFileFromDisk();
    },
    'file-close-tab': () => {
      void options.closeActiveTab();
    },
    'overlay-capsule-import': () => options.toggleOverlay('capsule-import'),
    'nav-quick-open': () => options.toggleOverlay('quick-open'),
    'nav-go-to-symbol': () => options.toggleOverlay('go-to-symbol'),
    'nav-project-search': () => options.toggleOverlay('search'),
    'nav-project-replace': () => options.toggleOverlay('replace'),
    // RL-097 Slice 1 — Toggle the HTTP workspace bottom-panel tab.
    // Mod+Shift+K shortcut delegates to a dedicated option callback
    // so the App.tsx wiring can flip the active bottom-panel + show
    // it without re-implementing the openBottomPanel choreography.
    'workspace-toggle-http': () => options.toggleHttpWorkspace(),
    'workspace-toggle-sql': () => options.toggleSqlWorkspace(),
    'action-open-utility-pipelines': () => options.openUtilityPipelines(),
    'action-open-import-overlay': () => options.openImportOverlay(),
    'overlay-command-palette': () => options.toggleOverlay('palette'),
    'overlay-settings': () => options.toggleOverlay('settings'),
    'overlay-developer-utilities': () => options.openDeveloperUtilities(),
    'view-toggle-sidebar': () => options.toggleSidebar(),
    'view-toggle-console': () => options.toggleConsole(),
    // RL-069 Slice 1 — Both shortcuts read the registered utility
    // panel output via `useUtilityOutputStore` and write to the
    // clipboard. Cmd+Alt+R semantically replaces the clipboard with
    // the output (same write call as Copy Output today; the toast key
    // signals intent to the user). Slice 2 will diverge them once
    // detect()-driven Apply enters the picture.
    'utility-copy-output': () => {
      void writeUtilityOutputToClipboard('copy');
    },
    'utility-replace-clipboard': () => {
      void writeUtilityOutputToClipboard('replace');
    },
    // RL-069 Slice 2 — read the focused panel's apply descriptor and
    // fire it. Disabled / missing descriptors fall through to a
    // localized status notice so the keystroke is never silent.
    'utility-apply-from-input': () => {
      runUtilityApplyFromInput();
    },
    // RL-027 Slice 1.5 fold C — keyboard-accessible breakpoint toggle.
    // Reads the active tab + cursor line at dispatch time so the user
    // can toggle the breakpoint at the current line without leaving the
    // keyboard. The language-pack capability gate is enforced before
    // dispatch so Python / Go / Rust tabs cannot create persisted
    // breakpoints before their adapters ship.
    'debugger-toggle-breakpoint': () => {
      const activeTab = getActiveDebuggerTab();
      if (!activeTab) return;
      const line = getActiveEditorCursorLine();
      if (!line) return;
      useDebuggerStore.getState().toggleBreakpoint(activeTab.id, line);
    },
    // RL-027 Slice 1 — debugger control shortcuts. The `setPausedFrame(null)`
    // call clears the paused UI immediately; the worker pushes a fresh
    // frame if the next pause condition fires.
    'debugger-continue': () => {
      if (postDebuggerMessage({ type: 'resume' })) {
        useDebuggerStore.getState().setPausedFrame(null);
      }
    },
    'debugger-step-over': () => {
      if (postDebuggerMessage({ type: 'step', mode: 'over' })) {
        useDebuggerStore.getState().setPausedFrame(null);
      }
    },
    'debugger-step-into': () => {
      if (postDebuggerMessage({ type: 'step', mode: 'into' })) {
        useDebuggerStore.getState().setPausedFrame(null);
      }
    },
    'debugger-step-out': () => {
      if (postDebuggerMessage({ type: 'step', mode: 'out' })) {
        useDebuggerStore.getState().setPausedFrame(null);
      }
    },
  };
}

function canDispatchDebuggerShortcut(id: string): boolean {
  // RL-027 Slice 1.5 fold C — the breakpoint-toggle shortcut works
  // outside of any active debug session; the rest of the debugger
  // group requires a paused worker so F5 / F10 / F11 / Shift+F11
  // never compete with normal-mode keystrokes.
  if (id === 'debugger-toggle-breakpoint') {
    // Slice 2 — debugger is baseline; the Settings toggle is gone.
    return getActiveDebuggerTab() !== null &&
      getActiveEditorCursorLine() !== null;
  }
  if (!isDebugWorkerActive()) return false;
  const pausedFrame = useDebuggerStore.getState().pausedFrame;
  if (!pausedFrame) return false;
  if (id === 'debugger-step-out') {
    return pausedFrame.callStack.length > 0;
  }
  return true;
}

function getActiveDebuggerTab(): { id: string; language: string } | null {
  const { tabs, activeTabId } = useEditorStore.getState();
  if (!activeTabId) return null;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  if (!activeTab || !languageSupportsDebugger(activeTab.language)) return null;
  return activeTab;
}

// RL-069 Slice 1 — module-level in-flight flag. The shortcut handler
// is fire-and-forget, so a fast double-press of Cmd+Shift+C while the
// previous navigator.clipboard.writeText is still pending would queue
// two independent toasts. Dropping the duplicate keeps the visual
// feedback honest. Module-level state is acceptable here because the
// helper is only invoked from the global shortcut handler — there is
// no concurrent caller surface.
let utilityClipboardInFlight = false;

function getShortcutLabel(shortcutId: string): string | undefined {
  const definition = KEYBOARD_SHORTCUTS.find((entry) => entry.id === shortcutId);
  if (!definition) return undefined;
  const combo = resolveCombos(
    definition,
    useSettingsStore.getState().shortcutOverrides
  )[0];
  if (!combo) return undefined;

  const runtimePlatform =
    typeof window !== 'undefined' ? window.lingua?.platform ?? 'web' : 'web';
  const navigatorPlatform =
    typeof navigator !== 'undefined' ? navigator.platform : undefined;
  const displayPlatform = resolveShortcutDisplayPlatform(runtimePlatform, navigatorPlatform);
  return formatShortcutCombo(combo, displayPlatform);
}

function runUtilityApplyFromInput(): void {
  const handler = useUtilityOutputStore.getState().getApplyHandler();
  const pushNotice = useUIStore.getState().pushStatusNotice;

  // RL-069 Slice 3 — when a clipboard-on-focus value is pending, fold
  // it in BEFORE running the panel's apply. The panel's handler
  // applies the clipboard value as input first, then runs apply
  // against it. This keeps the gesture single-keystroke for the user.
  const pending = takePendingClipboardApply();
  if (pending) {
    try {
      pending.applyClipboardValue(pending.value);
    } catch {
      // Swallow — the panel's own validation should have run; we
      // surface the failure via the apply path that follows.
    }
    void trackEvent('utility.clipboard.applied', {
      utilityId: pending.utilityId,
    });
    pushNotice({
      tone: 'success',
      messageKey: 'utilities.toast.clipboardApplied',
      values: {
        toolName: i18next.t(`utilities.tool.${camelToolKey(pending.utilityId)}.titleLabel`),
      },
    });
    return;
  }

  if (!handler) {
    pushNotice({
      tone: 'info',
      messageKey: 'utilities.toast.applyUnavailable',
    });
    return;
  }

  const descriptor = handler();
  if (!descriptor || !descriptor.enabled) {
    pushNotice({
      tone: 'info',
      messageKey: 'utilities.toast.applyUnavailable',
    });
    return;
  }

  try {
    descriptor.run();
    // i18next.t is called eagerly here so the success toast can carry
    // the translated tool name even though `pushStatusNotice` only
    // forwards the value through i18next's interpolation pipeline. The
    // toolNameKey itself is never displayed raw.
    pushNotice({
      tone: 'success',
      messageKey: 'utilities.toast.applySuccess',
      values: {
        toolName: i18next.t(descriptor.toolNameKey),
      },
    });
  } catch {
    pushNotice({
      tone: 'error',
      messageKey: 'utilities.toast.applyUnavailable',
    });
  }
}

/**
 * Convert a kebab-case utility id to the camelCase i18n segment
 * (`html-entity` → `htmlEntity`). The catalog uses kebab ids; the
 * i18n key tree uses camel.
 */
function camelToolKey(id: string): string {
  return id.replace(/-([a-z])/g, (_match, ch: string) => ch.toUpperCase());
}

async function writeUtilityOutputToClipboard(mode: 'copy' | 'replace'): Promise<void> {
  if (utilityClipboardInFlight) return;
  utilityClipboardInFlight = true;
  try {
    const provider = useUtilityOutputStore.getState().getProvider();
    const pushNotice = useUIStore.getState().pushStatusNotice;

    if (!provider) {
      pushNotice({ tone: 'info', messageKey: 'utilities.toast.copyOutputEmpty' });
      return;
    }

    const value = provider();
    if (value === null || value === '') {
      pushNotice({ tone: 'info', messageKey: 'utilities.toast.copyOutputEmpty' });
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      pushNotice({
        tone: 'success',
        messageKey:
          mode === 'replace'
            ? 'utilities.toast.replaceClipboardSuccess'
            : 'utilities.toast.copyOutputSuccess',
        values: {
          shortcut:
            getShortcutLabel(
              mode === 'replace' ? 'utility-replace-clipboard' : 'utility-copy-output'
            ) ?? '',
        },
      });
    } catch {
      pushNotice({ tone: 'error', messageKey: 'utilities.toast.copyOutputFailed' });
    }
  } finally {
    utilityClipboardInFlight = false;
  }
}

export function useGlobalShortcuts(options: UseGlobalShortcutsOptions) {
  const overrides = useSettingsStore((state) => state.shortcutOverrides);

  const dispatchable = useMemo<readonly ShortcutDefinition[]>(
    () => KEYBOARD_SHORTCUTS.filter((entry) => entry.id !== 'overlay-close'),
    []
  );

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Escape is handled separately so it only fires when an overlay is open,
    // which avoids stealing the key from text inputs elsewhere in the app.
    if (event.key === 'Escape') {
      if (options.overlay !== 'none') {
        event.preventDefault();
        options.closeOverlay();
      }
      return;
    }

    const actions = buildActionMap(options);
    for (const definition of dispatchable) {
      const combos = resolveCombos(definition, overrides);
      if (!combos.some((combo) => matchesCombo(event, combo))) continue;
      if (definition.group === 'debugger' && !canDispatchDebuggerShortcut(definition.id)) continue;
      const action = actions[definition.id];
      if (!action) continue;
      event.preventDefault();
      action(event);
      return;
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      handleKeyDown(event);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
