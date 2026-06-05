import type { EditorState } from '../types';
import i18next from 'i18next';
import { useSettingsStore } from './settingsStore';
import { useUIStore } from './uiStore';
import { trackEvent } from '../utils/telemetry';
import {
  isRuntimeModeImplemented,
  languageHasRuntimeModes,
} from '../../shared/runtimeModes';
import {
  defaultWorkflowMode,
  supportsWorkflowMode,
} from '../../shared/workflowMode';
import type { EditorGet, EditorSet } from './editorStoreContext';
import {
  isVariableInspectorSupportedLanguage,
  languageSupportsStdin,
} from './editorTabUtils';

/**
 * RL-128 fold A/B — runtime/workflow mode + capability-toggle setter factory
 * for the editor store. Bundles `setTabRuntimeMode`, `setTabWorkflowMode`,
 * `setTabAutoLogEnabled`, `setTabStdinBuffer`, and the mutually-exclusive
 * `setTabCompareEnabled` / `setTabVariableInspectorEnabled`. Extracted verbatim
 * from `editorStore.ts`; `createModeActions(set, get)` gets the same zustand
 * `set`/`get` the inline `create()` callback received, so the panel-reveal +
 * status-notice + telemetry side-effects and the Compare/Variables mutual
 * exclusion are unchanged.
 */
export function createModeActions(
  set: EditorSet,
  get: EditorGet
): Pick<
  EditorState,
  | 'setTabRuntimeMode'
  | 'setTabWorkflowMode'
  | 'setTabAutoLogEnabled'
  | 'setTabStdinBuffer'
  | 'setTabCompareEnabled'
  | 'setTabVariableInspectorEnabled'
> {
  return {
    setTabRuntimeMode: (id, mode) => {
      const { tabs } = get();
      const target = tabs.find((t) => t.id === id);
      if (!target) return;
      if (!languageHasRuntimeModes(target.language)) {
        // Non-JS/TS tabs do not own a runtime-mode surface. Refuse
        // silently — the selector is hidden so this branch is only
        // reachable via a programmatic / palette / shortcut call.
        return;
      }
      if (!isRuntimeModeImplemented(mode)) {
        // RL-019 Slice 1 fold G — surface a status notice when the
        // user (via shortcut, palette, or programmatic call) tries to
        // switch into a mode that has not landed yet. Kept defensive
        // for future RuntimeMode enum additions.
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'runtimeMode.notice.notImplemented',
        });
        return;
      }
      if (target.runtimeMode === mode) return;
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id
            ? mode === 'node'
              ? (() => {
                  const { variableInspectorEnabled: _drop, ...rest } = t;
                  void _drop;
                  return { ...rest, runtimeMode: mode };
                })()
              : { ...t, runtimeMode: mode }
            : t
        ),
      }));
      // Runtime-mode changes are an output-surface change too. Keep
      // this centralized so the toolbar, Command Palette, and
      // keyboard cycle all reveal the same destination panel.
      useUIStore.getState().openBottomPanel(
        mode === 'browser-preview' ? 'browser-preview' : 'console'
      );
      // RL-019 Slice 1 fold G — confirm the change with a soft
      // status-notice toast. The selector itself flips immediately;
      // this is the audit trail for users who change modes via the
      // keyboard cycle or the command palette.
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey: 'runtimeMode.changedNotice',
        values: { mode: i18next.t(`runtimeMode.mode.${mode === 'browser-preview' ? 'browserPreview' : mode}`) },
      });
      // RL-019 Slice 1 fold A — funnel telemetry for runtime-mode
      // adoption. Both `mode` and `language` are closed enums; the
      // shared allowlist + worker mirror enforce the contract.
      void trackEvent('runtime.mode_changed', {
        mode,
        language: target.language,
      });
    },

    setTabWorkflowMode: (id, mode) => {
      const { tabs } = get();
      const target = tabs.find((t) => t.id === id);
      if (!target) return;
      // RL-020 Slice 2 — refuse modes the language does not support.
      // The toolbar UI greys out unsupported segments so this branch
      // is only reachable via a programmatic / palette / shortcut
      // call. No status notice — the toolbar's tooltip already
      // explains why the segment is disabled.
      if (!supportsWorkflowMode(target.language, mode)) return;
      const current = target.workflowMode ?? defaultWorkflowMode(target.language);
      if (current === mode) return;
      const shouldShowFirstSwitchNotice =
        !useSettingsStore.getState().firstWorkflowModeSwitchAcknowledged &&
        current === 'scratchpad' &&
        mode !== 'scratchpad';
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id ? { ...t, workflowMode: mode } : t
        ),
      }));
      if (shouldShowFirstSwitchNotice) {
        useUIStore.getState().pushStatusNotice({
          tone: 'info',
          messageKey: 'workflowMode.firstSwitch.notice',
        });
        useSettingsStore.getState().acknowledgeFirstWorkflowModeSwitch();
      }
      // Telemetry — explicit user gesture (toolbar click, palette,
      // keyboard cycle). The language-change auto-correction in
      // `renameTab` emits with `trigger: 'language_change'` from its
      // own call site.
      void trackEvent('runtime.workflow_mode_changed', {
        language: target.language,
        from: current,
        to: mode,
        trigger: 'toolbar',
      });
    },

    setTabAutoLogEnabled: (id, enabled) => {
      const target = get().tabs.find((t) => t.id === id);
      if (!target) return;
      // RL-020 Slice 5 fold C — auto-log is JS/TS-only this slice; the
      // setter refuses any other language so a programmatic palette /
      // shortcut entry point cannot leave a misleading flag on a Rust
      // or Python tab.
      if (target.language !== 'javascript' && target.language !== 'typescript') {
        return;
      }
      set((state) => ({
        tabs: state.tabs.map((t) => {
          if (t.id !== id) return t;
          if (enabled === null) {
            if (t.autoLogEnabled === undefined) return t;
            const { autoLogEnabled: _drop, ...rest } = t;
            void _drop;
            return rest;
          }
          return { ...t, autoLogEnabled: enabled };
        }),
      }));
      // RL-020 Slice 5 — the per-tab override path is the OTHER way to
      // flip the auto-log gate (besides Settings → Editor). Emit the
      // adoption signal here too so the closed-enum metric in
      // `src/shared/telemetry.ts` counts BOTH surfaces consistently
      // (Settings toggle + Command-palette toggle + future per-tab
      // toolbar affordances). The `null` clear path resolves back to
      // the per-language Settings default; we do not have a single
      // boolean to report at that moment, so the clear path stays
      // silent rather than risk a misleading emission.
      if (enabled !== null) {
        void trackEvent('runtime.auto_log_enabled', {
          language: target.language,
          enabled,
        });
      }
    },

    setTabStdinBuffer: (id, text) => {
      const target = get().tabs.find((t) => t.id === id);
      if (!target) return;
      if (!languageSupportsStdin(target.language)) return;
      set((state) => ({
        tabs: state.tabs.map((t) => {
          if (t.id !== id) return t;
          if (text === null || text === '') {
            if (t.stdinBuffer === undefined) return t;
            const { stdinBuffer: _drop, ...rest } = t;
            void _drop;
            return rest;
          }
          return { ...t, stdinBuffer: text };
        }),
      }));
    },

    /**
     * RL-020 Slice 8/9 — write the per-tab Compare toggle. `null`
     * clears the field (the toggle returns to disabled). Compare and
     * Variables are mutually exclusive because both consume the result
     * panel's focused inspection surface; enforce that invariant here
     * so keyboard shortcuts, command palette actions, and UI buttons all
     * share the same state transition.
     */
    setTabCompareEnabled: (id, enabled) => {
      set((state) => ({
        tabs: state.tabs.map((t) => {
          if (t.id !== id) return t;
          if (enabled === null || enabled === false) {
            if (t.compareWithSnapshotEnabled === undefined) return t;
            const { compareWithSnapshotEnabled: _drop, ...rest } = t;
            void _drop;
            return rest;
          }
          // RL-020 Slice 9 — mutual exclusion with Variables.
          const { variableInspectorEnabled: _dropInspector, ...rest } = t;
          void _dropInspector;
          return { ...rest, compareWithSnapshotEnabled: true };
        }),
      }));
    },

    /**
     * RL-020 Slice 9 — write the per-tab Variables toggle. `null`
     * clears the field. Mutually exclusive with `setTabCompareEnabled`:
     * enabling Variables forces Compare off. Unsupported runtimes no-op
     * before clearing Compare so the user cannot lose a valid Compare
     * view by trying to enable Variables on an ineligible tab.
     */
    setTabVariableInspectorEnabled: (id, enabled) => {
      set((state) => ({
        tabs: state.tabs.map((t) => {
          if (t.id !== id) return t;
          if (enabled === null || enabled === false) {
            if (t.variableInspectorEnabled === undefined) return t;
            const { variableInspectorEnabled: _drop, ...rest } = t;
            void _drop;
            return rest;
          }
          if (
            !isVariableInspectorSupportedLanguage(t.language) ||
            t.runtimeMode === 'node'
          ) {
            return t;
          }
          // Mutual exclusion with Compare.
          const { compareWithSnapshotEnabled: _dropCompare, ...rest } = t;
          void _dropCompare;
          return { ...rest, variableInspectorEnabled: true };
        }),
      }));
    },
  };
}
