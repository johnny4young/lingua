import { create } from 'zustand';
import type { EditorState, FileTab, Language } from '../types';
import { getActiveAppLanguage } from '../i18n';
import { defaultCodeForLanguage, extensionForLanguage } from '../utils/languageMeta';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
import { joinAbsolute } from '../utils/filePath';
import {
  formatSource,
  isFormatterSupported,
  type FormatterFailure,
} from '../utils/formatters';
import i18next from 'i18next';
import { useProjectStore } from './projectStore';
import { useRecentFilesStore } from './recentFilesStore';
import { useDependencyDetectionStore } from './dependencyDetectionStore';
import { useResultStore } from './resultStore';
import { useSettingsStore } from './settingsStore';
import { useUIStore } from './uiStore';
import { currentEffectiveTier } from '../hooks/useEntitlement';
import { isLanguageAllowed, withinTabBudget } from '../../shared/entitlements';
import { pushUpsellNotice } from '../utils/upsellNotice';
import { trackEvent } from '../utils/telemetry';
import {
  coerceRuntimeMode,
  defaultRuntimeModeFor,
  isRuntimeModeImplemented,
  languageHasRuntimeModes,
  type RuntimeMode,
} from '../../shared/runtimeModes';
import {
  coerceWorkflowMode,
  defaultWorkflowMode,
  supportsWorkflowMode,
  type WorkflowMode,
} from '../../shared/workflowMode';

function runtimeModeForNewTab(
  language: Language,
  explicit?: RuntimeMode
): RuntimeMode | undefined {
  if (!languageHasRuntimeModes(language)) return undefined;
  if (explicit !== undefined) return coerceRuntimeMode(explicit, language) ?? undefined;
  const settingsDefault = useSettingsStore.getState().defaultRuntimeMode;
  return (
    coerceRuntimeMode(settingsDefault, language) ??
    defaultRuntimeModeFor(language) ??
    undefined
  );
}

function runtimeModeForRestoredTab(
  language: Language,
  persisted?: RuntimeMode
): RuntimeMode | undefined {
  return coerceRuntimeMode(persisted, language) ?? undefined;
}

/**
 * RL-020 Slice 2 — resolve the workflow mode for a freshly created
 * tab. Honours the per-language default the user set in Settings
 * (when present) and falls through to the shared
 * `defaultWorkflowMode` helper otherwise. The Settings lookup is
 * tolerant: if the persisted default is no longer valid for the
 * language (e.g. user upgraded from a build where `debug` was
 * allowed for Python), `coerceWorkflowMode` snaps it back to a
 * supported value.
 */
function workflowModeForNewTab(
  language: Language,
  explicit?: WorkflowMode
): WorkflowMode {
  if (explicit !== undefined) {
    return coerceWorkflowMode(explicit, language);
  }
  const settingsDefault = useSettingsStore
    .getState()
    .workflowModeDefaultsByLanguage[language];
  if (settingsDefault !== undefined) {
    return coerceWorkflowMode(settingsDefault, language);
  }
  return defaultWorkflowMode(language);
}

/**
 * RL-020 Slice 2 — resolve the workflow mode for a tab restored from
 * a previous session. Same shape as the runtime-mode restore helper
 * — `coerceWorkflowMode` snaps an unknown / unsupported persisted
 * value back to the language's default so a tampered or stale
 * localStorage entry cannot leave the live store in a bad shape.
 */
function workflowModeForRestoredTab(
  language: Language,
  persisted?: WorkflowMode
): WorkflowMode {
  return coerceWorkflowMode(persisted, language);
}

function languageSupportsAutoLog(language: Language): boolean {
  return language === 'javascript' || language === 'typescript';
}

function dropAutoLogIfUnsupported<T extends FileTab>(tab: T): T {
  if (languageSupportsAutoLog(tab.language)) return tab;
  const { autoLogEnabled: _drop, ...rest } = tab;
  void _drop;
  return rest as T;
}

/**
 * RL-020 Slice 6 — the worker-side stdin patch ships for the three
 * languages whose runner goes through a worker today: JS / TS via
 * `js-worker.ts` and Python via `python-worker.ts`. Go / Rust runners
 * are WASM-based (Go) or compile-and-run on the host; threading
 * stdin into those is a follow-up because the patch surface is
 * different.
 */
function languageSupportsStdin(language: Language): boolean {
  return (
    language === 'javascript' ||
    language === 'typescript' ||
    language === 'python'
  );
}

function dropStdinIfUnsupported<T extends FileTab>(tab: T): T {
  if (languageSupportsStdin(tab.language)) return tab;
  const { stdinBuffer: _drop, ...rest } = tab;
  void _drop;
  return rest as T;
}

/**
 * RL-020 Slice 7 fold D — drop the per-tab one-shot extended
 * timeout when the tab no longer points at the code the user was
 * inspecting. Rename to a different language is the canonical case:
 * the user pressed "Run with extended timeout" while looking at a
 * JS buffer; renaming the tab to Go shouldn't silently apply the
 * one-shot to the next Go run. Cleared in `renameTab` and on
 * Save-As (`persistTab`) too, alongside the symmetric autoLog +
 * stdin drops.
 */
function dropNextRunTimeoutOverride<T extends FileTab>(tab: T): T {
  if (tab.nextRunTimeoutOverrideMs === undefined) return tab;
  const { nextRunTimeoutOverrideMs: _drop, ...rest } = tab;
  void _drop;
  return rest as T;
}

/**
 * RL-020 Slice 8 — drop the per-tab Compare flag whenever the
 * language changes (rename / Save-As). The comparator snapshot is
 * tracked by the result store; the editor-store side just owns the
 * toggle bit. Symmetric to `dropAutoLogIfUnsupported` /
 * `dropStdinIfUnsupported`.
 */
function dropCompareIfLanguageChanged<T extends FileTab>(
  tab: T,
  previousLanguage: Language | null
): T {
  if (previousLanguage === null || tab.language === previousLanguage) return tab;
  if (tab.compareWithSnapshotEnabled === undefined) return tab;
  const { compareWithSnapshotEnabled: _drop, ...rest } = tab;
  void _drop;
  return rest as T;
}

/**
 * RL-020 Slice 9 — set of languages the variable inspector
 * captures for. Renames / Save-As to a language outside this set
 * drops the per-tab inspector flag.
 */
const VARIABLE_INSPECTOR_SUPPORTED_LANGUAGES: ReadonlySet<Language> = new Set([
  'javascript',
  'typescript',
  'python',
]);

export function isVariableInspectorSupportedLanguage(
  language: Language
): boolean {
  return VARIABLE_INSPECTOR_SUPPORTED_LANGUAGES.has(language);
}

/**
 * RL-020 Slice 9 — drop the per-tab variable inspector flag when
 * the rename / Save-As lands on a language outside the supported
 * set. The scope snapshot itself is tracked by the result store;
 * this helper only owns the toggle bit.
 */
function dropVariableInspectorIfLanguageChanged<T extends FileTab>(
  tab: T,
  previousLanguage: Language | null
): T {
  if (previousLanguage === null || tab.language === previousLanguage) return tab;
  if (tab.variableInspectorEnabled === undefined) return tab;
  if (isVariableInspectorSupportedLanguage(tab.language)) return tab;
  const { variableInspectorEnabled: _drop, ...rest } = tab;
  void _drop;
  return rest as T;
}

export const createDefaultTab = (language: Language = 'javascript'): FileTab => {
  const id = crypto.randomUUID();
  const short = id.slice(0, 8);
  // RL-019 Slice 1 — JS/TS tabs adopt the per-app default mode (fold
  // B). Non-JS/TS tabs deliberately omit the field.
  const runtimeMode = runtimeModeForNewTab(language);
  // RL-020 Slice 2 — every tab carries an explicit workflow mode so
  // the toolbar segmented control and `useAutoRun` short-circuit
  // both have a single source of truth. Language-specific defaults
  // come from `settingsStore.workflowModeDefaultsByLanguage` (when
  // the user has overridden the shared helper) or the
  // `defaultWorkflowMode` shared helper.
  const workflowMode = workflowModeForNewTab(language);
  return {
    id,
    name: `untitled-${short}.${extensionForLanguage(language)}`,
    language,
    content: defaultCodeForLanguage(language),
    isDirty: false,
    runtimeMode,
    workflowMode,
  };
};

export { languageFromPath } from '../utils/language';

const FORMATTER_FAILURE_NOTICE: Record<FormatterFailure, { tone: 'error' | 'info'; messageKey: string } | null> = {
  unsupported: null,
  'parse-error': { tone: 'error', messageKey: 'editor.formatOnSave.parseError' },
  'binary-missing': { tone: 'error', messageKey: 'editor.formatOnSave.binaryMissing' },
  'web-unavailable': { tone: 'info', messageKey: 'editor.formatOnSave.webUnavailable' },
  unknown: { tone: 'error', messageKey: 'editor.formatOnSave.unknownError' },
};

/**
 * Try to format `content` when `formatOnSave` is enabled and the tab's
 * language has a formatter strategy. Emits a dismissable status notice on
 * failure but never throws — we always fall back to saving the original
 * content so format issues never block persistence.
 */
async function resolveFormattedContent(
  tab: FileTab
): Promise<string> {
  const { formatOnSave } = useSettingsStore.getState();
  if (!formatOnSave) return tab.content;
  if (!isFormatterSupported(tab.language)) return tab.content;

  const result = await formatSource(tab.language, tab.content);
  if (result.ok) return result.formatted;

  const notice = FORMATTER_FAILURE_NOTICE[result.failure];
  if (notice) {
    useUIStore.getState().pushStatusNotice({
      tone: notice.tone,
      messageKey: notice.messageKey,
      values: { name: tab.name },
      detail: result.message,
    });
  }
  return tab.content;
}

function basename(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? filePath;
}

/**
 * RL-077 — write the tab to disk through the capability registry.
 *
 *   - If the tab already carries a `{ rootId, relativePath }` pair
 *     and we are not in Save-As, write through that capability.
 *   - Otherwise prompt the save dialog: main mints a fresh capability
 *     bound to the parent directory of the chosen target, and we
 *     write the file under that capability's relative path.
 *
 * `tab.filePath` is kept up to date as a display-only string for
 * tooltips and session-store persistence, but is never sent to an IPC
 * handler — every actual filesystem touch goes through `rootId`.
 */
async function persistTab(
  tab: FileTab,
  forceSaveAs = false
): Promise<
  | (FileTab & { filePath: string; rootId: string; relativePath: string })
  | null
> {
  let rootId: string | undefined = tab.rootId;
  let relativePath: string | undefined = tab.relativePath;
  let absolutePath: string | undefined = tab.filePath;
  let mintedRootId: string | null = null;

  const needsPicker = forceSaveAs || !rootId || !relativePath;
  if (needsPicker) {
    const result = await window.lingua.fs.saveDialog(tab.name);
    if (result.canceled) return null;
    rootId = result.rootId;
    mintedRootId = result.rootId;
    relativePath = result.fileRelativePath;
    absolutePath = joinAbsolute(result.rootPath, result.fileRelativePath);
  }

  if (!rootId || !relativePath || !absolutePath) {
    return null;
  }

  const name = basename(absolutePath);
  const language = resolveFileLanguageOrPlaintext(name);
  const runtimeMode = runtimeModeForRestoredTab(language, tab.runtimeMode);
  // RL-020 Slice 2 — re-resolve the workflow mode against the
  // possibly-changed language (Save-As may flip `.js` → `.py`). The
  // coerce helper snaps an unsupported choice back to the language
  // default; this branch is the silent equivalent of the explicit
  // language-change auto-correction in `renameTab`.
  const workflowMode = workflowModeForRestoredTab(language, tab.workflowMode);
  // Save As can change the tab's language just like renameTab. Keep
  // JS / TS overrides, but drop stale auto-log flags for every other
  // language so Python / Go tabs never carry an ignored JS-only bit.
  const autoLogEnabled = languageSupportsAutoLog(language)
    ? tab.autoLogEnabled
    : undefined;
  // RL-020 Slice 6 — same Save-As cleanup for the stdin buffer.
  // `foo.js` → `foo.go` must drop the JS-only buffer so the worker
  // never receives a value it can't honor and the tab stops
  // surfacing the Input panel.
  const stdinBuffer = languageSupportsStdin(language)
    ? tab.stdinBuffer
    : undefined;
  // RL-020 Slice 8 — Save-As that changes the language drops the
  // Compare toggle. Same-language Save-As (renaming `foo.js` →
  // `bar.js`) keeps the toggle on so the user's workflow isn't
  // interrupted.
  const compareWithSnapshotEnabled =
    tab.language === language && tab.compareWithSnapshotEnabled === true
      ? true
      : undefined;
  // RL-020 Slice 9 — Save-As that lands on an unsupported language
  // drops the Variables toggle. Same-language Save-As keeps it on.
  const variableInspectorEnabled =
    tab.language === language &&
    tab.variableInspectorEnabled === true &&
    VARIABLE_INSPECTOR_SUPPORTED_LANGUAGES.has(language)
      ? true
      : undefined;
  const {
    autoLogEnabled: _staleAutoLogEnabled,
    stdinBuffer: _staleStdinBuffer,
    // RL-020 Slice 7 — the per-tab one-shot extended-timeout
    // override is always scoped to the code the user was looking
    // at when they armed it. A Save-As that retitles or changes
    // language drops the override.
    nextRunTimeoutOverrideMs: _staleNextRunTimeoutOverride,
    compareWithSnapshotEnabled: _staleCompareEnabled,
    variableInspectorEnabled: _staleInspectorEnabled,
    ...tabWithoutDropped
  } = tab;
  void _staleAutoLogEnabled;
  void _staleStdinBuffer;
  void _staleNextRunTimeoutOverride;
  void _staleCompareEnabled;
  void _staleInspectorEnabled;
  const nextTab: FileTab & { filePath: string; rootId: string; relativePath: string } = {
    ...tabWithoutDropped,
    filePath: absolutePath,
    rootId,
    relativePath,
    name,
    language,
    runtimeMode,
    workflowMode,
    ...(autoLogEnabled !== undefined ? { autoLogEnabled } : {}),
    ...(stdinBuffer !== undefined ? { stdinBuffer } : {}),
    ...(compareWithSnapshotEnabled !== undefined
      ? { compareWithSnapshotEnabled }
      : {}),
    ...(variableInspectorEnabled !== undefined
      ? { variableInspectorEnabled }
      : {}),
  };
  let content: string;
  try {
    content = await resolveFormattedContent(nextTab);
    const wrote = await window.lingua.fs.write(rootId, relativePath, content);
    if (!wrote) {
      if (mintedRootId) await window.lingua.fs.revokeRoot(mintedRootId).catch(() => {});
      return null;
    }
  } catch (error) {
    if (mintedRootId) await window.lingua.fs.revokeRoot(mintedRootId).catch(() => {});
    throw error;
  }

  return {
    ...nextTab,
    content,
    isDirty: false,
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  pendingReveal: null,

  requestReveal: (target) => {
    // `line` must be at least 1 — Monaco rejects 0-indexed positions. We clamp
    // defensively so upstream surfaces (Project Search, Go to Symbol) can stay
    // agnostic about Monaco's 1-indexed contract.
    if (!target.filePath && !target.tabId) {
      throw new Error('requestReveal requires either filePath or tabId');
    }
    const safeLine = Math.max(1, Math.floor(target.line));
    const safeColumn =
      target.column === undefined ? undefined : Math.max(1, Math.floor(target.column));
    set({
      pendingReveal: {
        filePath: target.filePath,
        tabId: target.tabId,
        line: safeLine,
        column: safeColumn,
      },
    });
  },

  clearPendingReveal: () => set({ pendingReveal: null }),

  addTab: (tab) => {
    const { tabs } = get();
    if (!isLanguageAllowed(currentEffectiveTier(), tab.language)) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: i18next.t('upsell.feature.extraLanguages'),
      });
      void trackEvent('feature.blocked', {
        entitlement: 'languages-extended',
        tier: currentEffectiveTier(),
      });
      return;
    }
    // RL-060: block new-tab creation once the Free ceiling is hit. Users
    // already over the ceiling (grandfathered data from before gating
    // shipped) keep their tabs; only additions past the ceiling are
    // refused so nobody loses work in the upgrade.
    if (!withinTabBudget(currentEffectiveTier(), tabs.length + 1)) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: i18next.t('upsell.feature.extraTabs'),
      });
      // RL-065 — emit feature.blocked so the consenting user's
      // telemetry reflects the friction. Allowlist already permits
      // this event with `entitlement` + `tier`.
      void trackEvent('feature.blocked', {
        entitlement: 'tabs',
        tier: currentEffectiveTier(),
      });
      return;
    }
    // RL-019 Slice 1 — defensively assign a runtime mode if the
    // caller forgot. Most call sites go through `createDefaultTab`
    // which already sets it, but `addTab({ ...tab, content })`
    // callers might rebuild the object and lose the field.
    const runtimeMode = runtimeModeForNewTab(tab.language, tab.runtimeMode);
    // RL-020 Slice 2 — same defensive backfill for the workflow
    // mode. `duplicateActiveTab` for example forwards a tab through
    // `addTab` without going through `createDefaultTab`.
    const workflowMode = workflowModeForNewTab(tab.language, tab.workflowMode);
    const newTab = dropStdinIfUnsupported(
      dropAutoLogIfUnsupported({
        ...tab,
        isDirty: false,
        runtimeMode,
        workflowMode,
      })
    );
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));
  },

  restoreTabs: (tabs, activeTabId) =>
    set({
      tabs: tabs.map((tab) =>
        dropStdinIfUnsupported(dropAutoLogIfUnsupported({
          ...tab,
          isDirty: false,
          // RL-019 Slice 1 — backfill missing runtime modes for JS/TS
          // tabs restored from a pre-Slice-1 session. Non-JS/TS tabs
          // never carry the field.
          runtimeMode: runtimeModeForRestoredTab(tab.language, tab.runtimeMode),
          // RL-020 Slice 2 — backfill missing workflow modes for tabs
          // restored from a pre-Slice-2 session. Every tab carries
          // the field in Slice 2 onwards; the coerce helper snaps a
          // tampered persisted value back to the language default.
          workflowMode: workflowModeForRestoredTab(
            tab.language,
            tab.workflowMode
          ),
        }))
      ),
      activeTabId: activeTabId ?? null,
    }),

  removeTab: (id) =>
    set((state) => {
      const target = state.tabs.find((t) => t.id === id);
      const tabs = state.tabs.filter((t) => t.id !== id);
      const activeTabId =
        state.activeTabId === id
          ? tabs[tabs.length - 1]?.id ?? null
          : state.activeTabId;
      // RL-077 — revoke a tab-private capability when the last tab
      // using it goes away. Project-tree opens share the active
      // project's `rootId` (revoked centrally by `closeProject`), so
      // we leave that one alone; single-file picker / deep-link /
      // session-restore mints are unique per tab and would otherwise
      // accumulate in main's registry until app shutdown.
      if (target?.rootId) {
        const stillUsed = tabs.some((t) => t.rootId === target.rootId);
        const projectRootId =
          useProjectStore.getState().currentProject?.rootId;
        if (!stillUsed && target.rootId !== projectRootId) {
          void window.lingua.fs
            .revokeRoot(target.rootId)
            .catch(() => {});
        }
      }
      // RL-025 Slice A — evict the per-tab detection cache so the
      // dependency panel cannot surface stale rows for a closed
      // tab id that is later reused by a fresh `addTab()`.
      useDependencyDetectionStore.getState().evictTab(id);
      return { tabs, activeTabId };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  updateContent: (id, content) =>
    set((state) => ({
      // RL-070 — clear lifecycle markers when the user edits the buffer.
      // A stale `error` dot or `running` state would mislead the user
      // about the current code's outcome; reset to `idle` so the next
      // run produces a fresh signal.
      tabs: state.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              content,
              isDirty: true,
              executionState: 'idle' as const,
              parseError: null,
            }
          : t
      ),
    })),

  /**
   * RL-024 Slice 2 — refresh a tab's buffer from disk content WITHOUT
   * marking it dirty. Used by the Replace in files overlay after a
   * successful IPC apply so the tab visually reflects the on-disk
   * change. Unlike `updateContent` (which is the user-edit path),
   * `isDirty` stays false because the disk and the buffer now match.
   * Cmd+Z does NOT restore the previous content — replace-in-files
   * is documented as a non-undoable operation in the confirmation
   * modal copy.
   */
  setTabContentFromDisk: (id: string, content: string) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              content,
              isDirty: false,
              executionState: 'idle' as const,
              parseError: null,
            }
          : t
      ),
    })),

  setTabExecutionState: (id, executionState, parseError = null) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, executionState, parseError } : t
      ),
    })),

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

  // RL-020 Slice 7 fold D — set / clear the one-shot extended-timeout
  // override on a tab. `null` or a non-positive number clears the
  // field. Positive numbers are stored as-is and consumed at most
  // once by `executeTabManually`.
  // RL-020 Slice 8 — write the per-tab Compare toggle. `null` clears
  // the field (the toggle returns to disabled). No-op when the tab
  // is missing. Mutual exclusion with `setTabVariableInspectorEnabled`
  // is enforced here: turning Compare on forces Variables off.
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

  // RL-020 Slice 9 — write the per-tab Variables toggle. `null`
  // clears the field. Mutually exclusive with `setTabCompareEnabled`:
  // enabling Variables forces Compare off.
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

  setTabNextRunTimeoutOverride: (id, timeoutMs) => {
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== id) return t;
        const isValid =
          typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0;
        if (!isValid) {
          if (t.nextRunTimeoutOverrideMs === undefined) return t;
          const { nextRunTimeoutOverrideMs: _drop, ...rest } = t;
          void _drop;
          return rest;
        }
        return { ...t, nextRunTimeoutOverrideMs: timeoutMs };
      }),
    }));
  },

  markSaved: (id) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, isDirty: false } : t
      ),
    })),

  openFile: async (rootId, relativePath, name, language, displayPath) => {
    const { tabs } = get();

    const existing = tabs.find(
      (t) => t.rootId === rootId && t.relativePath === relativePath
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }

    if (!withinTabBudget(currentEffectiveTier(), tabs.length + 1)) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: i18next.t('upsell.feature.extraTabs'),
      });
      // RL-065 — same emit on the openFile gate so both rejection
      // paths surface a feature.blocked event.
      void trackEvent('feature.blocked', {
        entitlement: 'tabs',
        tier: currentEffectiveTier(),
      });
      return;
    }

    const content = await window.lingua.fs.read(rootId, relativePath);
    const filePath = displayPath ?? relativePath;

    const newTab: FileTab = {
      id: crypto.randomUUID(),
      name,
      language,
      content,
      isDirty: false,
      rootId,
      relativePath,
      filePath,
      // RL-019 Slice 1 — disk-backed JS/TS opens adopt the per-app
      // default runtime mode; non-JS/TS files leave the field unset.
      runtimeMode: runtimeModeForNewTab(language),
      // RL-020 Slice 2 — disk-backed opens also adopt the per-app
      // default workflow mode so the toolbar segment has a value to
      // reflect on first render.
      workflowMode: workflowModeForNewTab(language),
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));

    useRecentFilesStore.getState().addRecentFile({ filePath, name, language });
  },

  openFileFromDisk: async () => {
    const result = await window.lingua.fs.selectFile();
    if (result.canceled) return;
    const language = resolveFileLanguageOrPlaintext(result.fileName);
    const { tabs } = get();
    const filePath = joinAbsolute(result.rootPath, result.fileRelativePath);

    const existing = tabs.find(
      (t) =>
        (t.rootId === result.rootId && t.relativePath === result.fileRelativePath) ||
        t.filePath === filePath
    );
    if (existing) {
      await window.lingua.fs.revokeRoot(result.rootId).catch(() => {});
      set({ activeTabId: existing.id });
      return;
    }

    if (!withinTabBudget(currentEffectiveTier(), tabs.length + 1)) {
      await window.lingua.fs.revokeRoot(result.rootId).catch(() => {});
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: i18next.t('upsell.feature.extraTabs'),
      });
      void trackEvent('feature.blocked', {
        entitlement: 'tabs',
        tier: currentEffectiveTier(),
      });
      return;
    }

    const newTab: FileTab = {
      id: crypto.randomUUID(),
      name: result.fileName,
      language,
      content: result.content,
      isDirty: false,
      rootId: result.rootId,
      relativePath: result.fileRelativePath,
      filePath,
      // RL-019 Slice 1 — same JS/TS default mode as openFile().
      runtimeMode: runtimeModeForNewTab(language),
      // RL-020 Slice 2 — same per-language workflow-mode default.
      workflowMode: workflowModeForNewTab(language),
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));

    useRecentFilesStore
      .getState()
      .addRecentFile({ filePath, name: result.fileName, language });
  },

  saveActiveTab: async () => {
    const { activeTabId, saveTabById } = get();
    if (!activeTabId) return;
    await saveTabById(activeTabId);
  },

  saveActiveTabAs: async () => {
    const { activeTabId, saveTabById } = get();
    if (!activeTabId) return;
    await saveTabById(activeTabId, true);
  },

  saveTabById: async (id, forceSaveAs = false) => {
    const { tabs } = get();
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return false;

    const previousPath = tab.filePath;
    const previousRootId = tab.rootId;
    const previousLanguage = tab.language;
    const savedTab = await persistTab(tab, forceSaveAs);
    if (!savedTab) return false;

    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? savedTab : t)),
    }));

    // RL-020 Slice 8 — Save-As that changed the language invalidates
    // the result-store snapshot ring for the saved tab. Re-read
    // `activeTabId` at this point (not the value captured before the
    // async `persistTab` hop) so that if the user switched tabs
    // mid-save we do NOT drop the new active tab's snapshot ring.
    // `useAutoRun` already clears the ring on tab switch; if the
    // user navigated away during the file picker, the ring belongs
    // to a different tab and we must leave it alone.
    if (
      savedTab.language !== previousLanguage &&
      get().activeTabId === id
    ) {
      useResultStore.getState().clearLastSuccessfulSnapshot();
    }
    if (savedTab.language !== previousLanguage) {
      useDependencyDetectionStore.getState().evictTab(id);
    }

    if (previousRootId && previousRootId !== savedTab.rootId) {
      const rootStillUsed = tabs.some(
        (t) => t.id !== id && t.rootId === previousRootId
      );
      const projectRootId = useProjectStore.getState().currentProject?.rootId;
      if (!rootStillUsed && previousRootId !== projectRootId) {
        await window.lingua.fs.revokeRoot(previousRootId).catch(() => {});
      }
    }

    if (forceSaveAs || previousPath !== savedTab.filePath) {
      useRecentFilesStore.getState().addRecentFile({
        filePath: savedTab.filePath,
        name: savedTab.name,
        language: savedTab.language,
      });
    }

    return true;
  },

  closeTab: async (id) => {
    const { tabs, removeTab, saveTabById } = get();
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return true;

    if (!tab.isDirty) {
      removeTab(id);
      return true;
    }

    // Show confirmation dialog
    const response = await window.lingua.confirmCloseTab(
      tab.name,
      getActiveAppLanguage()
    );
    if (response === 0) {
      const saved = await saveTabById(id);
      if (!saved) return false;
      removeTab(id);
      return true;
    } else if (response === 1) {
      // Discard
      removeTab(id);
      return true;
    }
    // Cancel
    return false;
  },

  duplicateActiveTab: () => {
    const { tabs, activeTabId, addTab } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    addTab({
      id: crypto.randomUUID(),
      name: `Copy of ${tab.name}`,
      language: tab.language,
      content: tab.content,
    });
  },

  /**
   * Rename a tab in place. The new name flows through
   * `resolveFileLanguageOrPlaintext` so a `.py` → `.go` rename also
   * flips the Monaco language. The tab is marked dirty because the
   * on-disk filename diverges from the in-memory one until the next
   * save reuses Save As.
   *
   * No-ops when the tab does not exist or the trimmed name is empty,
   * so accidental Enter on an empty rename input does not silently
   * destroy the filename.
   */
  renameTab: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // RL-020 Slice 2 fold D — when a rename auto-corrects the
    // workflow mode (e.g. JS Debug → Rust forces Run because Rust
    // has no debugger adapter), emit telemetry with
    // `trigger: 'language_change'` so the audit trail covers the
    // implicit transition, not just toolbar gestures.
    const correctionsToEmit: Array<{
      language: Language;
      from: WorkflowMode;
      to: WorkflowMode;
    }> = [];
    // RL-020 Slice 8 — track whether the rename flipped the active
    // tab's language so we can drop the result-store comparator
    // snapshot below.
    let activeTabLanguageChanged = false;
    let tabLanguageChanged = false;
    set((state) => {
      const next = state.tabs.map((tab) => {
        if (tab.id !== id) return tab;
        if (tab.name === trimmed) return tab;
        const language = resolveFileLanguageOrPlaintext(trimmed);
        const previousLanguage = tab.language;
        const runtimeMode = runtimeModeForRestoredTab(language, tab.runtimeMode);
        const previousWorkflow =
          tab.workflowMode ?? defaultWorkflowMode(tab.language);
        const workflowMode = workflowModeForRestoredTab(
          language,
          tab.workflowMode
        );
        if (previousWorkflow !== workflowMode) {
          correctionsToEmit.push({
            language,
            from: previousWorkflow,
            to: workflowMode,
          });
        }
        if (
          previousLanguage !== language &&
          state.activeTabId === tab.id
        ) {
          activeTabLanguageChanged = true;
        }
        if (previousLanguage !== language) {
          tabLanguageChanged = true;
        }
        // RL-020 Slice 5 fold C — when the new language is not
        // JS / TS, clear any persisted per-tab auto-log override so a
        // stale flag from before the rename does not influence the
        // resolved gate. The per-language Settings default is the
        // only owner of the value for the new language.
        const renamed = {
          ...tab,
          name: trimmed,
          language,
          runtimeMode,
          workflowMode,
          isDirty: true,
        };
        if (languageSupportsAutoLog(language)) {
          // RL-020 Slice 7 — the per-tab one-shot extended timeout
          // override is always scoped to the code the user was
          // looking at when they armed it. A rename to ANY new
          // language clears the override, even if the new language
          // still supports auto-log. The user can re-arm via the
          // palette if they want to.
          return dropVariableInspectorIfLanguageChanged(
            dropCompareIfLanguageChanged(
              dropNextRunTimeoutOverride({
                ...renamed,
                autoLogEnabled: tab.autoLogEnabled,
              }),
              previousLanguage
            ),
            previousLanguage
          );
        }
        return dropVariableInspectorIfLanguageChanged(
          dropCompareIfLanguageChanged(
            dropNextRunTimeoutOverride(
              dropStdinIfUnsupported(dropAutoLogIfUnsupported(renamed))
            ),
            previousLanguage
          ),
          previousLanguage
        );
      });
      return { tabs: next };
    });
    // RL-020 Slice 8 — same-tab language change invalidates the
    // result-store snapshot ring (it was captured for the previous
    // language and would surface as a stale comparator). Tab
    // switches handle their own cascade via `clear()`.
    if (activeTabLanguageChanged) {
      useResultStore.getState().clearLastSuccessfulSnapshot();
    }
    if (tabLanguageChanged) {
      useDependencyDetectionStore.getState().evictTab(id);
    }
    for (const correction of correctionsToEmit) {
      void trackEvent('runtime.workflow_mode_changed', {
        language: correction.language,
        from: correction.from,
        to: correction.to,
        trigger: 'language_change',
      });
    }
  },

  /**
   * Close every tab whose id is NOT the supplied one. Each dirty tab
   * still funnels through `closeTab` so the existing
   * `confirmCloseTab` prompt is honored — the user cannot lose
   * unsaved work via this bulk action even when triggered by a
   * single context-menu click.
   */
  closeOtherTabs: async (id) => {
    const { tabs, closeTab } = get();
    const targets = tabs.filter((tab) => tab.id !== id).map((tab) => tab.id);
    for (const tabId of targets) {
      const closed = await closeTab(tabId);
      if (!closed) break;
    }
  },

  /**
   * Close every tab to the right of the supplied id, preserving the
   * pivot. Same dirty-check contract as `closeOtherTabs`.
   */
  closeTabsToRight: async (id) => {
    const { tabs, closeTab } = get();
    const pivot = tabs.findIndex((tab) => tab.id === id);
    if (pivot < 0) return;
    const targets = tabs.slice(pivot + 1).map((tab) => tab.id);
    for (const tabId of targets) {
      const closed = await closeTab(tabId);
      if (!closed) break;
    }
  },

  /**
   * Close every open tab. Goes through `closeTab` per-tab so dirty
   * prompts still fire — the user can cancel mid-batch.
   */
  closeAllTabs: async () => {
    const { tabs, closeTab } = get();
    const targets = tabs.map((tab) => tab.id);
    for (const tabId of targets) {
      const closed = await closeTab(tabId);
      if (!closed) break;
    }
  },
}));
