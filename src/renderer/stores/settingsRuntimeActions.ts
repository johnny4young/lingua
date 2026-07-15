import type { SettingsState } from '../types';
import { trackEvent } from '../utils/telemetry';
import {
  isRuntimeModeImplemented,
  type RuntimeMode,
} from '../../shared/runtimeModes';
import {
  isWorkflowMode,
  supportsWorkflowMode,
  type WorkflowMode,
} from '../../shared/workflowMode';
import {
  isRuntimeTimeoutPreset,
  RUNTIME_TIMEOUT_SUPPORTED_LANGUAGE_SET,
  type RuntimeTimeoutPreset,
} from '../../shared/runtimeTimeoutPresets';
import { isBrowserPreviewRefreshInterval } from '../../shared/browserPreviewRefresh';
import {
  SETTINGS_AUTO_LOG_LANGUAGE_SET,
  SETTINGS_INLINE_LINT_LANGUAGE_SET,
  SETTINGS_WORKFLOW_MODE_LANGUAGE_SET,
} from './settingsDefaults';
import type { SettingsGet, SettingsSet } from './settingsStoreContext';

/**
 * RL-129 fold B — runtime/execution setter factory for the settings store.
 * Bundles loop-iteration, format-on-save, native-execution-ack,
 * default-runtime-mode, per-language workflow/auto-log defaults, stdin-panel
 * visibility, variable-inspector surface, per-language timeout preset, countdown
 * toggle, Ruby runtime preference, and the first-workflow-switch ack. Extracted
 * verbatim from `settingsStore.ts`; each closed-enum setter rejects unsupported
 * languages / tokens and emits its adoption telemetry on real change only.
 */
export function createRuntimeActions(
  set: SettingsSet,
  get: SettingsGet
): Pick<
  SettingsState,
  | 'setMaxLoopIterations'
  | 'toggleFormatOnSave'
  | 'toggleSmartPasteDetection'
  | 'setNativeExecutionAcknowledged'
  | 'setDefaultRuntimeMode'
  | 'setNotebookDefaultCellLanguage'
  | 'setWorkflowModeDefault'
  | 'setScratchpadAutoLogDefault'
  | 'setBrowserPreviewRefreshInterval'
  | 'setInlineLintEnabled'
  | 'toggleShowStdinPanel'
  | 'setShowStatusBar'
  | 'setVariableInspectorSurface'
  | 'setRuntimeTimeoutPreset'
  | 'toggleShowTimeoutCountdown'
  | 'setRubyRuntimePreference'
  | 'acknowledgeFirstWorkflowModeSwitch'
> {
  return {
    setMaxLoopIterations: (maxLoopIterations) => set({ maxLoopIterations }),
    toggleFormatOnSave: () => set((s) => ({ formatOnSave: !s.formatOnSave })),
    // RL-110 — flip smart-paste detection. Plain boolean toggle (mirrors
    // formatOnSave); adoption rides editor.smart_paste_shown/applied, not the
    // toggle itself, so no telemetry here.
    toggleSmartPasteDetection: () =>
      set((s) => ({ smartPasteDetectionEnabled: !s.smartPasteDetectionEnabled })),
    setNativeExecutionAcknowledged: (nativeExecutionAcknowledged) =>
      set({ nativeExecutionAcknowledged }),
    // RL-019 Slice 1 fold B — guard the setter so only implemented
    // modes can be persisted as the per-app default. This remains
    // defensive for future enum additions that an older build
    // should not persist.
    setDefaultRuntimeMode: (mode: RuntimeMode) => {
      if (!isRuntimeModeImplemented(mode)) return;
      set({ defaultRuntimeMode: mode });
    },
    // RL-043 Slice C fold D — seed language for new notebook code cells.
    // Guards the closed pair so a programmatic call can't smuggle an
    // unrunnable language (e.g. python) into the default.
    setNotebookDefaultCellLanguage: (language) => {
      if (language !== 'javascript' && language !== 'typescript') return;
      set({ notebookDefaultCellLanguage: language });
    },
    // RL-020 Slice 2 — set or clear the per-language workflow
    // default. `null` resets to the shared helper. The setter
    // refuses any mode the language does not support so the
    // Settings UI cannot smuggle an invalid combination through
    // a programmatic call.
    setWorkflowModeDefault: (language: string, mode: WorkflowMode | null) => {
      if (!SETTINGS_WORKFLOW_MODE_LANGUAGE_SET.has(language)) return;
      set((state) => {
        const next = { ...state.workflowModeDefaultsByLanguage };
        if (mode === null) {
          delete next[language];
        } else {
          if (!isWorkflowMode(mode)) return state;
          if (!supportsWorkflowMode(language, mode)) return state;
          next[language] = mode;
        }
        return { workflowModeDefaultsByLanguage: next };
      });
    },
    // RL-020 Slice 5 — flip the per-language auto-log default.
    // The setter is the only authoritative entry point for the
    // map; it rejects unsupported languages and emits the
    // `runtime.auto_log_enabled` adoption signal on every flip
    // (idempotent calls do not re-emit). The telemetry call is
    // gated upstream by the user's consent state via
    // `trackEvent`; no consent gate duplication is needed here.
    setScratchpadAutoLogDefault: (language: string, enabled: boolean) => {
      if (!SETTINGS_AUTO_LOG_LANGUAGE_SET.has(language)) return;
      let changed = false;
      set((state) => {
        const current = state.scratchpadAutoLogByLanguage[language] === true;
        if (current === enabled) return state;
        changed = true;
        return {
          scratchpadAutoLogByLanguage: {
            ...state.scratchpadAutoLogByLanguage,
            [language]: enabled,
          },
        };
      });
      if (changed) {
        void trackEvent('runtime.auto_log_enabled', { language, enabled });
      }
    },
    // RL-119 Slice 1 — closed persisted preference. Adoption telemetry fires
    // from the first actual live refresh, not from changing the dropdown, so
    // selecting Off never claims that an automatic refresh occurred.
    setBrowserPreviewRefreshInterval: (intervalMs) => {
      if (!isBrowserPreviewRefreshInterval(intervalMs)) return;
      set((state) =>
        state.browserPreviewRefreshIntervalMs === intervalMs
          ? state
          : { browserPreviewRefreshIntervalMs: intervalMs }
      );
    },
    // RL-108 — flip inline lint for one language. Pure state write (no toggle
    // telemetry; adoption rides `editor.lint_diagnostic_emitted`). No-op for
    // languages outside the supported set so a stray call can't seed a key.
    setInlineLintEnabled: (language: string, enabled: boolean) => {
      if (!SETTINGS_INLINE_LINT_LANGUAGE_SET.has(language)) return;
      set((state) => {
        const current = state.inlineLintEnabledByLanguage[language] === true;
        if (current === enabled) return state;
        return {
          inlineLintEnabledByLanguage: {
            ...state.inlineLintEnabledByLanguage,
            [language]: enabled,
          },
        };
      });
    },
    // RL-112 — flip the persistent status-bar visibility. Emits
    // `editor.status_bar_toggled` on real change only (idempotent calls do
    // not re-emit); the telemetry call is consent-gated upstream by
    // `trackEvent`, so no consent duplication is needed here.
    setShowStatusBar: (enabled: boolean) => {
      let changed = false;
      set((state) => {
        if (state.showStatusBar === enabled) return state;
        changed = true;
        return { showStatusBar: enabled };
      });
      if (changed) {
        void trackEvent('editor.status_bar_toggled', { enabled });
      }
    },
    // RL-020 Slice 6 fold D — flip the bottom-panel stdin tab
    // visibility. Per-tab buffers are preserved either way.
    toggleShowStdinPanel: () =>
      set((s) => ({ showStdinPanel: !s.showStdinPanel })),
    // RL-093 Slice 3 — switch the variable inspector surface.
    // Rejects unknown tokens so the closed-enum contract holds even
    // against the palette / scripted callers. Emits an adoption
    // telemetry event so we can see whether the floating default
    // should stay the default in future builds.
    setVariableInspectorSurface: (surface) => {
      if (surface !== 'floating' && surface !== 'bottom') return;
      let changed = false;
      set((s) => {
        if (s.variableInspectorSurface === surface) return s;
        changed = true;
        return { variableInspectorSurface: surface };
      });
      if (changed) {
        void trackEvent('runtime.variable_inspector_surface_changed', { surface });
      }
    },
    // RL-020 Slice 7 — write the per-language preset. Rejects
    // unsupported languages + unknown preset tokens so the
    // closed-enum contract holds even against programmatic
    // callers (palette, scripted tests). Fires
    // `runtime.timeout_preset_changed` (fold A) on actual
    // change only — idempotent calls do not re-emit.
    setRuntimeTimeoutPreset: (
      language: string,
      preset: RuntimeTimeoutPreset
    ) => {
      if (!RUNTIME_TIMEOUT_SUPPORTED_LANGUAGE_SET.has(language)) return;
      if (!isRuntimeTimeoutPreset(preset)) return;
      let changed = false;
      set((state) => {
        if (state.runtimeTimeoutPresetByLanguage[language] === preset) {
          return state;
        }
        changed = true;
        return {
          runtimeTimeoutPresetByLanguage: {
            ...state.runtimeTimeoutPresetByLanguage,
            [language]: preset,
          },
        };
      });
      if (changed) {
        void trackEvent('runtime.timeout_preset_changed', {
          language,
          preset,
        });
      }
    },
    // RL-020 Slice 7 fold E — flip the countdown-pill toggle.
    toggleShowTimeoutCountdown: () =>
      set((s) => ({ showTimeoutCountdown: !s.showTimeoutCountdown })),
    // RL-042 Slice 6 — set the Ruby runtime dispatcher preference.
    // Telemetry mirrors the closed enum so dashboards see the
    // distribution. Tampered values are rejected by the setter
    // itself; the sanitizer in `settingsMerge` is the additional
    // rehydrate defense.
    setRubyRuntimePreference: (preference) => {
      if (
        preference !== 'auto' &&
        preference !== 'system' &&
        preference !== 'wasm'
      ) {
        return;
      }
      const prev = get().rubyRuntimePreference;
      if (prev === preference) return;
      set({ rubyRuntimePreference: preference });
      void trackEvent('runtime.ruby_runtime_preference_changed', {
        preference,
      });
    },
    // RL-020 Slice 2 fold F — record that the onboarding toast has
    // been seen so future workflow-mode switches stay silent.
    acknowledgeFirstWorkflowModeSwitch: () =>
      set({ firstWorkflowModeSwitchAcknowledged: true }),
  };
}
