import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  KEYBOARD_SHORTCUTS,
  isEditableShortcutCombo,
  type ShortcutCombo,
  type ShortcutOverrideMap,
} from '../data/keyboardShortcuts';
import {
  DEFAULT_KEYMAP_PRESET_ID,
  findKeymapPreset,
  isKnownKeymapPresetId,
} from '../data/keymapPresets';
import {
  DEFAULT_THEME_PACK_ID,
  findThemePack,
  isKnownThemePackId,
  type ThemePackAppearance,
} from '../data/themePacks';
import { currentEffectiveTier } from '../hooks/useEntitlement';
import { isEntitled } from '../../shared/entitlements';
import { trackEvent } from '../utils/telemetry';
import type { SettingsState } from '../types';
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
  defaultRuntimeTimeoutPresetSeed,
  isRuntimeTimeoutPreset,
  isRuntimeTimeoutSupportedLanguage,
  RUNTIME_TIMEOUT_SUPPORTED_LANGUAGE_SET,
  type RuntimeTimeoutPreset,
} from '../../shared/runtimeTimeoutPresets';

const DEFAULT_EDITOR_FONT_FAMILY = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";

/**
 * RL-020 Slice 2 fold C — seeded defaults surfaced in Settings → Editor
 * the first time the user reaches a Slice-2 build. Without this seed,
 * a fresh install (no persisted defaults) would resolve every new tab
 * via the shared `defaultWorkflowMode` helper and the Settings rows
 * would look unset — making the per-language defaults feature
 * invisible.
 *
 * Sparse on purpose: every key here matches the language whose default
 * mode the shared helper already returns. The override is observably
 * a no-op until the user changes it, but the Settings row now shows
 * the chosen value as the active selection rather than "unset".
 */
const WORKFLOW_MODE_DEFAULT_SEED: Record<string, WorkflowMode> = {
  javascript: 'scratchpad',
  typescript: 'scratchpad',
  python: 'scratchpad',
};

const SETTINGS_WORKFLOW_MODE_LANGUAGE_SET: ReadonlySet<string> = new Set(
  Object.keys(WORKFLOW_MODE_DEFAULT_SEED)
);

/**
 * RL-020 Slice 5 — opt-in seed for the bare-expression auto-log mode.
 * JS / TS only. Default OFF so a fresh install never floods the
 * result panel with inline values until the user explicitly enables
 * the feature in Settings → Editor.
 */
const SCRATCHPAD_AUTO_LOG_DEFAULT_SEED: Record<string, boolean> = {
  javascript: false,
  typescript: false,
};

const SETTINGS_AUTO_LOG_LANGUAGE_SET: ReadonlySet<string> = new Set(
  Object.keys(SCRATCHPAD_AUTO_LOG_DEFAULT_SEED)
);

/**
 * RL-020 Slice 7 — sanitize a persisted
 * `runtimeTimeoutPresetByLanguage` map: drop languages outside the
 * Slice-7 supported set; drop non-enum preset tokens. Returns a
 * fresh object so callers can hand it to the store without
 * aliasing.
 */
function sanitizeRuntimeTimeoutPresets(
  value: unknown
): Record<string, RuntimeTimeoutPreset> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, RuntimeTimeoutPreset> = {};
  for (const [language, raw] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (!isRuntimeTimeoutSupportedLanguage(language)) continue;
    if (!isRuntimeTimeoutPreset(raw)) continue;
    out[language] = raw;
  }
  return out;
}

/**
 * Sanitize a persisted `scratchpadAutoLogByLanguage` map: drop
 * languages outside the JS / TS pair, coerce non-boolean values to
 * `false`. Returns a fresh object so callers can hand it directly
 * to the store without aliasing.
 */
function sanitizeScratchpadAutoLog(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [language, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!SETTINGS_AUTO_LOG_LANGUAGE_SET.has(language)) continue;
    out[language] = raw === true;
  }
  return out;
}

/**
 * Sanitize a persisted `workflowModeDefaultsByLanguage` map: drop
 * languages outside the Settings surface, drop values that aren't
 * valid `WorkflowMode` strings, drop modes the language does not
 * support. Returns a fresh object so callers can hand it directly to
 * the store without aliasing.
 */
function sanitizeWorkflowModeDefaults(
  value: unknown
): Record<string, WorkflowMode> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, WorkflowMode> = {};
  for (const [language, rawMode] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (!SETTINGS_WORKFLOW_MODE_LANGUAGE_SET.has(language)) continue;
    if (!isWorkflowMode(rawMode)) continue;
    if (!supportsWorkflowMode(language, rawMode)) continue;
    out[language] = rawMode;
  }
  return out;
}

const APP_LANGUAGES = ['system', 'en', 'es'] as const;

function isAppLanguage(value: unknown): value is SettingsState['language'] {
  return typeof value === 'string' && (APP_LANGUAGES as readonly string[]).includes(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

const MAX_TOKENS_PER_COMBO = 5;
const MAX_COMBOS_PER_SHORTCUT = 4;

function shortcutOverridesEqual(
  left: ShortcutOverrideMap,
  right: ShortcutOverrideMap
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    const leftKey = leftKeys[index];
    const rightKey = rightKeys[index];
    if (!leftKey || !rightKey) return false;
    if (leftKey !== rightKey) return false;
    const leftCombos = left[leftKey] ?? [];
    const rightCombos = right[rightKey] ?? [];
    if (leftCombos.length !== rightCombos.length) return false;
    for (let comboIndex = 0; comboIndex < leftCombos.length; comboIndex += 1) {
      const leftTokens = leftCombos[comboIndex]?.tokens ?? [];
      const rightTokens = rightCombos[comboIndex]?.tokens ?? [];
      if (leftTokens.length !== rightTokens.length) return false;
      for (let tokenIndex = 0; tokenIndex < leftTokens.length; tokenIndex += 1) {
        if (leftTokens[tokenIndex] !== rightTokens[tokenIndex]) {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * RL-089 — exported so the profile-import path can sanitize a
 * crafted profile's `shortcutOverrides` map before writing it to the
 * live store. The persist-middleware merge already runs this on
 * rehydrate; the import path goes around persist and would otherwise
 * leave un-validated overrides live for the rest of the session.
 */
export function sanitizeShortcutOverrides(value: unknown): ShortcutOverrideMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const knownIds = new Set(KEYBOARD_SHORTCUTS.map((entry) => entry.id));
  const out: Record<string, readonly ShortcutCombo[]> = {};
  for (const [key, rawCombos] of Object.entries(value as Record<string, unknown>)) {
    if (!knownIds.has(key)) continue;
    if (!Array.isArray(rawCombos)) continue;
    const combos: ShortcutCombo[] = [];
    for (const raw of rawCombos.slice(0, MAX_COMBOS_PER_SHORTCUT)) {
      if (!raw || typeof raw !== 'object') continue;
      const tokens = (raw as { tokens?: unknown }).tokens;
      if (!Array.isArray(tokens)) continue;
      if (tokens.length === 0 || tokens.length > MAX_TOKENS_PER_COMBO) continue;
      if (!tokens.every((token) => typeof token === 'string' && token.length > 0 && token.length <= 32)) {
        continue;
      }
      const combo = { tokens: tokens as readonly string[] };
      if (!isEditableShortcutCombo(combo)) continue;
      combos.push(combo);
    }
    if (combos.length > 0) out[key] = combos;
  }
  return out;
}

function themePackAppearanceMatchesSettings(
  settings: Pick<
    SettingsState,
    | 'theme'
    | 'editorTheme'
    | 'fontFamily'
    | 'fontSize'
    | 'fontLigatures'
    | 'layoutPreset'
    | 'syncShellWithEditorTheme'
  >,
  appearance: ThemePackAppearance
): boolean {
  return (
    settings.theme === appearance.theme &&
    settings.editorTheme === appearance.editorTheme &&
    settings.fontFamily === appearance.fontFamily &&
    settings.fontSize === appearance.fontSize &&
    settings.fontLigatures === appearance.fontLigatures &&
    settings.layoutPreset === appearance.layoutPreset &&
    settings.syncShellWithEditorTheme === appearance.syncShellWithEditorTheme
  );
}

function syncConsentMirror(
  telemetryConsent: SettingsState['telemetryConsent']
): void {
  const bridge = typeof window !== 'undefined' ? window.lingua?.consent : undefined;
  if (!bridge) {
    return;
  }
  void bridge.set(telemetryConsent).catch(() => {
    // Best-effort only; a mirror failure must never break the renderer.
  });
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      editorTheme: 'lingua-dark',
      fontSize: 14,
      fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
      fontLigatures: true,
      showLineNumbers: true,
      wordWrap: false,
      minimap: false,
      layoutPreset: 'horizontal',
      loopProtection: true,
      maxLoopIterations: 10_000,
      hideUndefined: true,
      restoreSession: false,
      formatOnSave: false,
      vimMode: false,
      nativeExecutionAcknowledged: false,
      syncShellWithEditorTheme: true,
      executionHistorySnapshotEnabled: true,
      telemetryConsent: 'unset',
      utilitiesClipboardOnFocusConsent: 'unset',
      debuggerEnabled: true,
      // RL-025 Slice A — master toggle for dependency detection +
      // the bottom-panel Dependencies tab. The rehydrate merge
      // below applies the fold-G tier-aware default when the
      // persisted state has no preference yet (Free → false, every
      // other tier → true). Once the user persists a choice via the
      // setter, that choice survives across reloads.
      dependencyDetectionEnabled: true,
      // RL-036 Phase A1 fold F — default ON so the first share-link
      // copy always surfaces the confirmation modal preview before
      // anything reaches the clipboard.
      shareLinkConfirmEnabled: true,
      // RL-044 Sub-slice G — master toggle for the
      // `<OutputLineBadge>` chip and output-origin metadata. Default
      // ON so a fresh install gets the affordance out of the box.
      // When OFF, runners skip origin capture where supported and
      // the runtime strips any returned line/origin metadata before
      // console, history, or capsule surfaces see it.
      outputSourceMappingEnabled: true,
      // RL-044 Sub-slice G — hover-on-chip → Monaco line flash
      // sub-gate. Default ON. When OFF the chip is still clickable
      // (cursor move), only the hover behaviour is suppressed.
      outputHighlightOnHoverEnabled: true,
      // RL-044 Sub-slice G — when the highlighted line is outside
      // the editor viewport, smooth-scroll via
      // `editor.revealLineInCenter(line, ScrollType.Smooth)`.
      // Default ON. When OFF the flash still fires but the
      // viewport stays put.
      outputSmoothScrollOffscreenEnabled: true,
      // RL-019 Slice 1 fold B — only `worker` is implemented today;
      // the setter rejects anything else, so this stays a constant
      // initial value until Slice 2 lands the desktop Node backend.
      defaultRuntimeMode: 'worker',
      // RL-020 Slice 2 — per-language workflow defaults. Initial
      // value is the fold-C seed; the merge function below preserves
      // user overrides on rehydrate and seeds missing keys.
      workflowModeDefaultsByLanguage: { ...WORKFLOW_MODE_DEFAULT_SEED },
      // RL-020 Slice 5 — per-language auto-log defaults. JS / TS
      // only; default OFF so the inline-results experience stays
      // opt-in (a quietly enabled flag could surprise a user with a
      // wall of inline values on first open).
      scratchpadAutoLogByLanguage: { ...SCRATCHPAD_AUTO_LOG_DEFAULT_SEED },
      // RL-020 Slice 6 fold D — bottom-panel `stdin` tab is offered
      // by default. The user can hide it from Settings → Editor;
      // disabling the tab does NOT clear per-tab `stdinBuffer`
      // values so re-enabling the tab restores the existing input.
      showStdinPanel: true,
      // RL-093 Slice 3 — variable inspector surface preference. Default
      // 'floating' keeps backward-compatible behavior for users upgrading
      // from earlier Slice 2 builds where only the FloatingVariablesCard
      // existed. Persisted so the choice survives reloads.
      variableInspectorSurface: 'floating',
      // RL-020 Slice 7 — per-language run-time preset. Seed honors
      // the pre-Slice-7 hardcoded DEFAULT_TIMEOUT per runner
      // (JS / TS / Go = 30 s = `normal`; Python = 120 s = `long`).
      // Rust is intentionally absent — its desktop kill path is in
      // main and unchanged.
      runtimeTimeoutPresetByLanguage: defaultRuntimeTimeoutPresetSeed(),
      // RL-020 Slice 7 fold E — countdown pill in the result panel
      // header while a run is in flight. Default OFF so the panel
      // stays quiet by default.
      showTimeoutCountdown: false,
      // RL-020 Slice 9 fold G — Variables toggle is opt-in by
      // default. Per-tab override (`variableInspectorEnabled`)
      // always wins; this is just the seed for fresh tabs.
      showVariableInspectorByDefault: false,
      // RL-020 Slice 9 fold E — base scope depth is 1. Settings →
      // Editor lets the user bump it (max enforced renderer-side by
      // `MAX_SCOPE_DEPTH`).
      variableInspectorScopeDepth: 1,
      // RL-044 Slice 1B fold E — rich console output toggle. Default
      // ON so the additive payload lights up out of the box; users
      // who prefer the legacy text-only console can flip this OFF in
      // Settings → Editor.
      consoleRichRenderingEnabled: true,
      // RL-042 Slice 6 — Ruby runtime preference. `auto` is the
      // friendliest default (system when detected, WASM otherwise).
      // Sanitization in the rehydrate handler below maps tampered
      // values back to this seed.
      rubyRuntimePreference: 'auto',
      // RL-019 Slice 2 fold E — Node first-run trust notice flag.
      // Defaults `false`; flipped to `true` after the first
      // successful Node-mode run.
      nodeRunnerFirstRunNoticeShown: false,
      // RL-020 Slice 2 fold F — onboarding-toast acknowledgement.
      firstWorkflowModeSwitchAcknowledged: false,
      // RL-101 Slice 1 — three persisted one-shot flags driving the
      // onboarding choreography. All default `false` so a fresh
      // install sees the full sequence; `hasCompletedOnboardingWelcome`
      // is also gated by `onboardingWelcomeSeedVersion` (fold E) so a
      // version bump re-arms the seed even for existing users.
      hasCompletedOnboardingWelcome: false,
      hasCompletedOnboardingFirstRun: false,
      hasCompletedOnboardingFirstSnippet: false,
      // RL-101 fold E — seed-version tracker. When the value persisted
      // here is strictly less than `SEEDED_SCRATCHPAD_VERSION` from
      // `src/renderer/onboarding/seedScratchpad.ts`, the choreography
      // hook re-seeds the welcome tab even though the welcome flag is
      // already `true`. Default `0` so first-install users get version
      // `1` immediately.
      onboardingWelcomeSeedVersion: 0,
      language: 'system',
      lastSeenVersion: null,
      hasCompletedTour: false,
      suppressTourAutoStart: false,
      shortcutOverrides: {},
      keymapPreset: DEFAULT_KEYMAP_PRESET_ID,
      themePack: DEFAULT_THEME_PACK_ID,

      // Each field the theme pack covers resets `themePack` to `default` so
      // the selector never lies about the active pack. Line numbers, word
      // wrap, and minimap aren't part of the pack so they stay untouched.
      setTheme: (theme) =>
        set({
          theme,
          themePack: DEFAULT_THEME_PACK_ID,
          // Explicit shell-polarity choice wins over sync. Without this, a
          // click on Dark/Light would be silently overridden whenever the
          // editor theme's polarity differs from the chosen shell.
          syncShellWithEditorTheme: false,
        }),
      setEditorTheme: (editorTheme) =>
        set({ editorTheme, themePack: DEFAULT_THEME_PACK_ID }),
      setFontSize: (fontSize) => set({ fontSize, themePack: DEFAULT_THEME_PACK_ID }),
      setFontFamily: (fontFamily) =>
        set((state) => {
          if (
            fontFamily !== DEFAULT_EDITOR_FONT_FAMILY &&
            !isEntitled(currentEffectiveTier(), 'FONT_PACK_EXTENDED')
          ) {
            return state;
          }
          return { fontFamily, themePack: DEFAULT_THEME_PACK_ID };
        }),
      toggleFontLigatures: () =>
        set((s) => ({
          fontLigatures: !s.fontLigatures,
          themePack: DEFAULT_THEME_PACK_ID,
        })),
      toggleLineNumbers: () => set((s) => ({ showLineNumbers: !s.showLineNumbers })),
      toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
      toggleMinimap: () => set((s) => ({ minimap: !s.minimap })),
      setLayoutPreset: (layoutPreset) =>
        set({ layoutPreset, themePack: DEFAULT_THEME_PACK_ID }),
      toggleLoopProtection: () => set((s) => ({ loopProtection: !s.loopProtection })),
      setMaxLoopIterations: (maxLoopIterations) => set({ maxLoopIterations }),
      toggleHideUndefined: () => set((s) => ({ hideUndefined: !s.hideUndefined })),
      toggleRestoreSession: () => set((s) => ({ restoreSession: !s.restoreSession })),
      toggleFormatOnSave: () => set((s) => ({ formatOnSave: !s.formatOnSave })),
      toggleVimMode: () => set((s) => ({ vimMode: !s.vimMode })),
      setNativeExecutionAcknowledged: (nativeExecutionAcknowledged) =>
        set({ nativeExecutionAcknowledged }),
      toggleSyncShellWithEditorTheme: () =>
        set((s) => ({
          syncShellWithEditorTheme: !s.syncShellWithEditorTheme,
          themePack: DEFAULT_THEME_PACK_ID,
        })),
      toggleExecutionHistorySnapshot: () =>
        set((s) => ({ executionHistorySnapshotEnabled: !s.executionHistorySnapshotEnabled })),
      setTelemetryConsent: (telemetryConsent) => {
        set({ telemetryConsent });
        // Mirror to main so `bootCrashReporter` can read consent at the
        // next app boot, before createWindow().
        syncConsentMirror(telemetryConsent);
      },
      // RL-069 Slice 3 — clipboard-on-focus consent. Local-only; no
      // mirror to main because the feature is renderer-scoped.
      setUtilitiesClipboardOnFocusConsent: (utilitiesClipboardOnFocusConsent) => {
        set({ utilitiesClipboardOnFocusConsent });
      },
      // RL-027 Slice 1 — debugger master switch.
      toggleDebuggerEnabled: () =>
        set((state) => ({ debuggerEnabled: !state.debuggerEnabled })),
      // RL-025 Slice A — dependency detection master switch.
      toggleDependencyDetectionEnabled: () =>
        set((state) => ({
          dependencyDetectionEnabled: !state.dependencyDetectionEnabled,
        })),
      // RL-036 Phase A1 fold F — share-link confirmation gate.
      toggleShareLinkConfirmEnabled: () =>
        set((state) => ({
          shareLinkConfirmEnabled: !state.shareLinkConfirmEnabled,
        })),
      // RL-044 Sub-slice G — three toggles for the output→source line
      // affordance. Master gates the chip and origin metadata; the
      // two sub-gates only affect renderer-side hover +
      // smooth-scroll behaviour.
      toggleOutputSourceMappingEnabled: () =>
        set((state) => ({
          outputSourceMappingEnabled: !state.outputSourceMappingEnabled,
        })),
      toggleOutputHighlightOnHoverEnabled: () =>
        set((state) => ({
          outputHighlightOnHoverEnabled: !state.outputHighlightOnHoverEnabled,
        })),
      toggleOutputSmoothScrollOffscreenEnabled: () =>
        set((state) => ({
          outputSmoothScrollOffscreenEnabled:
            !state.outputSmoothScrollOffscreenEnabled,
        })),
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
      applyThemePreset: (preset) =>
        set((state) => ({
          theme: preset.theme,
          editorTheme: preset.editorTheme,
          fontFamily: preset.fontFamily,
          fontSize: preset.fontSize,
          fontLigatures: preset.fontLigatures,
          layoutPreset: preset.layoutPreset,
          syncShellWithEditorTheme:
            preset.syncShellWithEditorTheme ?? state.syncShellWithEditorTheme,
          // Imported presets are user-authored; the built-in pack selector
          // should reset to default so it doesn't claim a bundle is in force.
          themePack: DEFAULT_THEME_PACK_ID,
        })),
      setLanguage: (language) => set({ language }),
      // RL-019 Slice 1 fold B — guard the setter so only implemented
      // modes can be persisted as the per-app default. This remains
      // defensive for future enum additions that an older build
      // should not persist.
      setDefaultRuntimeMode: (mode: RuntimeMode) => {
        if (!isRuntimeModeImplemented(mode)) return;
        set({ defaultRuntimeMode: mode });
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
      // RL-044 Slice 1B fold E — flip the rich console output toggle.
      toggleConsoleRichRendering: () =>
        set((s) => ({ consoleRichRenderingEnabled: !s.consoleRichRenderingEnabled })),
      // RL-042 Slice 6 — set the Ruby runtime dispatcher preference.
      // Telemetry mirrors the closed enum so dashboards see the
      // distribution. Tampered values are rejected by the setter
      // itself; the sanitizer below is the additional rehydrate
      // defense.
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
      setLastSeenVersion: (lastSeenVersion) => set({ lastSeenVersion }),
      setHasCompletedTour: (hasCompletedTour) => set({ hasCompletedTour }),
      setSuppressTourAutoStart: (suppressTourAutoStart) => set({ suppressTourAutoStart }),
      setShortcutOverride: (id, combos) =>
        set((state) => ({
          shortcutOverrides: { ...state.shortcutOverrides, [id]: combos },
          // Any manual edit peels the user out of a preset; the UI should
          // honestly show "Custom" (== default id with non-empty overrides)
          // so they don't think the preset is still in force.
          keymapPreset: DEFAULT_KEYMAP_PRESET_ID,
        })),
      clearShortcutOverride: (id) =>
        set((state) => {
          if (!(id in state.shortcutOverrides)) return state;
          const next = { ...state.shortcutOverrides };
          delete next[id];
          return {
            shortcutOverrides: next,
            keymapPreset: DEFAULT_KEYMAP_PRESET_ID,
          };
        }),
      resetShortcutOverrides: () =>
        set({ shortcutOverrides: {}, keymapPreset: DEFAULT_KEYMAP_PRESET_ID }),
      applyKeymapPreset: (presetId) => {
        const preset = findKeymapPreset(presetId);
        if (!preset) return;
        set({
          keymapPreset: preset.id,
          // Clone so callers can't mutate the canonical preset map by
          // editing the store value afterwards.
          shortcutOverrides: { ...preset.overrides },
        });
      },
      applyThemePack: (packId) => {
        const pack = findThemePack(packId);
        if (!pack) return;
        if (
          pack.id !== DEFAULT_THEME_PACK_ID &&
          !isEntitled(currentEffectiveTier(), 'THEME_PACK_EXTENDED')
        ) {
          return;
        }
        set({
          themePack: pack.id,
          theme: pack.appearance.theme,
          editorTheme: pack.appearance.editorTheme,
          fontFamily: pack.appearance.fontFamily,
          fontSize: pack.appearance.fontSize,
          fontLigatures: pack.appearance.fontLigatures,
          layoutPreset: pack.appearance.layoutPreset,
          syncShellWithEditorTheme: pack.appearance.syncShellWithEditorTheme,
        });
      },
    }),
    {
      name: 'lingua-settings',
      // Omit functions from persistence
      partialize: (state) => ({
        theme: state.theme,
        editorTheme: state.editorTheme,
        fontSize: state.fontSize,
        fontFamily: state.fontFamily,
        fontLigatures: state.fontLigatures,
        showLineNumbers: state.showLineNumbers,
        wordWrap: state.wordWrap,
        minimap: state.minimap,
        layoutPreset: state.layoutPreset,
        loopProtection: state.loopProtection,
        maxLoopIterations: state.maxLoopIterations,
        hideUndefined: state.hideUndefined,
        restoreSession: state.restoreSession,
        formatOnSave: state.formatOnSave,
        vimMode: state.vimMode,
        nativeExecutionAcknowledged: state.nativeExecutionAcknowledged,
        syncShellWithEditorTheme: state.syncShellWithEditorTheme,
        executionHistorySnapshotEnabled: state.executionHistorySnapshotEnabled,
        telemetryConsent: state.telemetryConsent,
        utilitiesClipboardOnFocusConsent: state.utilitiesClipboardOnFocusConsent,
        debuggerEnabled: state.debuggerEnabled,
        // RL-025 Slice A — persist the dependency-detection toggle so
        // the user's choice survives reloads. Rehydrate-merge below
        // applies the fold-G tier-aware default when this key is
        // absent.
        dependencyDetectionEnabled: state.dependencyDetectionEnabled,
        // RL-036 Phase A1 fold F — sticky preference so the gate
        // survives reloads.
        shareLinkConfirmEnabled: state.shareLinkConfirmEnabled,
        // RL-044 Sub-slice G — persist the three output-source-mapping
        // toggles. Defaults seed via the merge below when a persisted
        // payload predates the slice.
        outputSourceMappingEnabled: state.outputSourceMappingEnabled,
        outputHighlightOnHoverEnabled: state.outputHighlightOnHoverEnabled,
        outputSmoothScrollOffscreenEnabled:
          state.outputSmoothScrollOffscreenEnabled,
        defaultRuntimeMode: state.defaultRuntimeMode,
        workflowModeDefaultsByLanguage: state.workflowModeDefaultsByLanguage,
        scratchpadAutoLogByLanguage: state.scratchpadAutoLogByLanguage,
        showStdinPanel: state.showStdinPanel,
        variableInspectorSurface: state.variableInspectorSurface,
        runtimeTimeoutPresetByLanguage: state.runtimeTimeoutPresetByLanguage,
        showTimeoutCountdown: state.showTimeoutCountdown,
        consoleRichRenderingEnabled: state.consoleRichRenderingEnabled,
        rubyRuntimePreference: state.rubyRuntimePreference,
        firstWorkflowModeSwitchAcknowledged:
          state.firstWorkflowModeSwitchAcknowledged,
        language: state.language,
        lastSeenVersion: state.lastSeenVersion,
        hasCompletedTour: state.hasCompletedTour,
        suppressTourAutoStart: state.suppressTourAutoStart,
        // RL-101 Slice 1 — sticky onboarding choreography flags so a
        // user who has seen the welcome seed / first-run / first-snippet
        // toasts never sees them again across reloads. Reset toggles
        // in Settings re-arm each stage.
        hasCompletedOnboardingWelcome: state.hasCompletedOnboardingWelcome,
        hasCompletedOnboardingFirstRun: state.hasCompletedOnboardingFirstRun,
        hasCompletedOnboardingFirstSnippet:
          state.hasCompletedOnboardingFirstSnippet,
        onboardingWelcomeSeedVersion: state.onboardingWelcomeSeedVersion,
        shortcutOverrides: state.shortcutOverrides,
        keymapPreset: state.keymapPreset,
        themePack: state.themePack,
      }),
      merge: (persistedState, currentState) => {
        const persisted =
          persistedState && typeof persistedState === 'object'
            ? (persistedState as Partial<SettingsState>)
            : undefined;
        const merged = {
          ...currentState,
          ...persisted,
        };
        const hasSnapshotPreference =
          persisted != null && hasOwn(persisted, 'executionHistorySnapshotEnabled');
        const executionHistorySnapshotEnabled =
          typeof persisted?.executionHistorySnapshotEnabled === 'boolean'
            ? persisted.executionHistorySnapshotEnabled
            : hasSnapshotPreference
              ? false
              : currentState.executionHistorySnapshotEnabled;
        // RL-025 Slice A fold G — tier-aware default for the
        // dependency detection toggle. A present-but-non-boolean value
        // (corrupted write, future schema drift) falls back to the
        // tier-aware default exactly like an absent key, so the
        // surface never silently lands at `false` for someone who
        // shouldn't get the upsell-pressure default.
        const dependencyDetectionEnabled =
          typeof persisted?.dependencyDetectionEnabled === 'boolean'
            ? persisted.dependencyDetectionEnabled
            : currentEffectiveTier() === 'free'
              ? false
              : currentState.dependencyDetectionEnabled;
        const hasNativeExecutionAcknowledgement =
          persisted != null && hasOwn(persisted, 'nativeExecutionAcknowledged');
        const nativeExecutionAcknowledged =
          typeof persisted?.nativeExecutionAcknowledged === 'boolean'
            ? persisted.nativeExecutionAcknowledged
            : hasNativeExecutionAcknowledgement
              ? false
              : currentState.nativeExecutionAcknowledged;
        const shortcutOverrides = sanitizeShortcutOverrides(merged.shortcutOverrides);
        const requestedKeymapPreset = isKnownKeymapPresetId(merged.keymapPreset)
          ? merged.keymapPreset
          : DEFAULT_KEYMAP_PRESET_ID;
        const normalizedKeymapPreset =
          requestedKeymapPreset === DEFAULT_KEYMAP_PRESET_ID
            ? DEFAULT_KEYMAP_PRESET_ID
            : shortcutOverridesEqual(
                  shortcutOverrides,
                  findKeymapPreset(requestedKeymapPreset)?.overrides ?? {}
                )
              ? requestedKeymapPreset
              : DEFAULT_KEYMAP_PRESET_ID;
        const requestedThemePack = isKnownThemePackId(merged.themePack)
          ? merged.themePack
          : DEFAULT_THEME_PACK_ID;
        const normalizedThemePack =
          requestedThemePack === DEFAULT_THEME_PACK_ID
            ? DEFAULT_THEME_PACK_ID
            : themePackAppearanceMatchesSettings(
                  {
                    theme: merged.theme,
                    editorTheme: merged.editorTheme,
                    fontFamily: merged.fontFamily,
                    fontSize: merged.fontSize,
                    fontLigatures: merged.fontLigatures,
                    layoutPreset: merged.layoutPreset,
                    syncShellWithEditorTheme: merged.syncShellWithEditorTheme,
                  },
                  findThemePack(requestedThemePack)?.appearance ?? {
                    theme: currentState.theme,
                    editorTheme: currentState.editorTheme,
                    fontFamily: currentState.fontFamily,
                    fontSize: currentState.fontSize,
                    fontLigatures: currentState.fontLigatures,
                    layoutPreset: currentState.layoutPreset,
                    syncShellWithEditorTheme: currentState.syncShellWithEditorTheme,
                  }
                )
              ? requestedThemePack
              : DEFAULT_THEME_PACK_ID;

        // RL-019 Slice 1 — guard `defaultRuntimeMode` on rehydrate
        // the same way `setDefaultRuntimeMode` does at runtime. A
        // tampered localStorage entry with an unimplemented or
        // unknown string would otherwise survive into the live
        // store and surface a broken Select in Settings.
        const normalizedDefaultRuntimeMode =
          typeof merged.defaultRuntimeMode === 'string' &&
          isRuntimeModeImplemented(merged.defaultRuntimeMode as never)
            ? merged.defaultRuntimeMode
            : currentState.defaultRuntimeMode;
        // RL-020 Slice 2 fold C — sanitize the persisted defaults
        // map and seed any missing Scratchpad-language keys so the
        // Settings UI surfaces a populated row on upgrade. The
        // user's prior overrides win over the seed; the seed only
        // fills BLANK slots.
        const sanitizedWorkflowDefaults = sanitizeWorkflowModeDefaults(
          merged.workflowModeDefaultsByLanguage
        );
        const seededWorkflowDefaults: Record<string, WorkflowMode> = {
          ...WORKFLOW_MODE_DEFAULT_SEED,
          ...sanitizedWorkflowDefaults,
        };
        // RL-020 Slice 5 — sanitize the auto-log map the same way the
        // workflow defaults are sanitized + seeded on rehydrate. A
        // tampered persisted entry never survives into the live store
        // and missing keys default to `false`.
        const sanitizedAutoLog = sanitizeScratchpadAutoLog(
          merged.scratchpadAutoLogByLanguage
        );
        const seededAutoLog: Record<string, boolean> = {
          ...SCRATCHPAD_AUTO_LOG_DEFAULT_SEED,
          ...sanitizedAutoLog,
        };
        const firstWorkflowModeSwitchAcknowledged =
          typeof merged.firstWorkflowModeSwitchAcknowledged === 'boolean'
            ? merged.firstWorkflowModeSwitchAcknowledged
            : currentState.firstWorkflowModeSwitchAcknowledged;
        const showStdinPanel =
          typeof merged.showStdinPanel === 'boolean'
            ? merged.showStdinPanel
            : currentState.showStdinPanel;
        // RL-093 Slice 3 — guard the closed enum on rehydrate so a
        // tampered localStorage entry can't surface a broken
        // dropdown / route to a non-existent panel.
        const variableInspectorSurface: 'floating' | 'bottom' =
          merged.variableInspectorSurface === 'floating' ||
          merged.variableInspectorSurface === 'bottom'
            ? merged.variableInspectorSurface
            : currentState.variableInspectorSurface;
        // RL-020 Slice 7 — sanitize + seed the per-language preset
        // map. Tampered tokens never survive; missing language keys
        // fall back to the language default seed so the Settings UI
        // always shows a row for every supported language.
        const sanitizedTimeoutPresets = sanitizeRuntimeTimeoutPresets(
          merged.runtimeTimeoutPresetByLanguage
        );
        const seededTimeoutPresets: Record<string, RuntimeTimeoutPreset> = {
          ...defaultRuntimeTimeoutPresetSeed(),
          ...sanitizedTimeoutPresets,
        };
        const showTimeoutCountdown =
          typeof merged.showTimeoutCountdown === 'boolean'
            ? merged.showTimeoutCountdown
            : currentState.showTimeoutCountdown;
        // RL-044 Slice 1B fold E — guard against tampered / older
        // persisted state. Default to the seed (true) when the
        // persisted value is not a boolean.
        const consoleRichRenderingEnabled =
          typeof merged.consoleRichRenderingEnabled === 'boolean'
            ? merged.consoleRichRenderingEnabled
            : currentState.consoleRichRenderingEnabled;
        // RL-042 Slice 6 — same guard as the boolean above. Anything
        // outside the closed enum (`auto` / `system` / `wasm`) gets
        // mapped back to the seed.
        const rubyRuntimePreference: 'auto' | 'system' | 'wasm' =
          merged.rubyRuntimePreference === 'auto' ||
          merged.rubyRuntimePreference === 'system' ||
          merged.rubyRuntimePreference === 'wasm'
            ? merged.rubyRuntimePreference
            : currentState.rubyRuntimePreference;
        // RL-036 Phase A1 fold F — sanitize the persisted share-link
        // confirmation flag. Malformed entries (null, string, missing)
        // fall back to the safer default (ON) rather than silently
        // dropping the user into the no-modal path.
        const shareLinkConfirmEnabled =
          typeof merged.shareLinkConfirmEnabled === 'boolean'
            ? merged.shareLinkConfirmEnabled
            : currentState.shareLinkConfirmEnabled;
        // RL-044 Sub-slice G — sanitize the three output-source-mapping
        // toggles. Malformed entries (null, string, missing) fall back
        // to the initial-state default (ON) so users who installed
        // before the slice keep the affordance.
        const outputSourceMappingEnabled =
          typeof merged.outputSourceMappingEnabled === 'boolean'
            ? merged.outputSourceMappingEnabled
            : currentState.outputSourceMappingEnabled;
        const outputHighlightOnHoverEnabled =
          typeof merged.outputHighlightOnHoverEnabled === 'boolean'
            ? merged.outputHighlightOnHoverEnabled
            : currentState.outputHighlightOnHoverEnabled;
        const outputSmoothScrollOffscreenEnabled =
          typeof merged.outputSmoothScrollOffscreenEnabled === 'boolean'
            ? merged.outputSmoothScrollOffscreenEnabled
            : currentState.outputSmoothScrollOffscreenEnabled;
        // RL-101 Slice 1 — sanitize the onboarding choreography flags.
        // Tampered entries (null, string, undefined) fall back to the
        // initial `false` so the user always sees the welcome flow
        // exactly once. The seed-version tracker also defaults to 0
        // so any non-finite persisted value re-arms the seed.
        const hasCompletedOnboardingWelcome =
          typeof merged.hasCompletedOnboardingWelcome === 'boolean'
            ? merged.hasCompletedOnboardingWelcome
            : currentState.hasCompletedOnboardingWelcome;
        const hasCompletedOnboardingFirstRun =
          typeof merged.hasCompletedOnboardingFirstRun === 'boolean'
            ? merged.hasCompletedOnboardingFirstRun
            : currentState.hasCompletedOnboardingFirstRun;
        const hasCompletedOnboardingFirstSnippet =
          typeof merged.hasCompletedOnboardingFirstSnippet === 'boolean'
            ? merged.hasCompletedOnboardingFirstSnippet
            : currentState.hasCompletedOnboardingFirstSnippet;
        const onboardingWelcomeSeedVersion =
          typeof merged.onboardingWelcomeSeedVersion === 'number' &&
          Number.isFinite(merged.onboardingWelcomeSeedVersion) &&
          merged.onboardingWelcomeSeedVersion >= 0
            ? Math.floor(merged.onboardingWelcomeSeedVersion)
            : currentState.onboardingWelcomeSeedVersion;
        return {
          ...merged,
          shareLinkConfirmEnabled,
          outputSourceMappingEnabled,
          outputHighlightOnHoverEnabled,
          outputSmoothScrollOffscreenEnabled,
          hasCompletedOnboardingWelcome,
          hasCompletedOnboardingFirstRun,
          hasCompletedOnboardingFirstSnippet,
          onboardingWelcomeSeedVersion,
          language: isAppLanguage(merged.language) ? merged.language : currentState.language,
          executionHistorySnapshotEnabled,
          dependencyDetectionEnabled,
          nativeExecutionAcknowledged,
          shortcutOverrides,
          keymapPreset: normalizedKeymapPreset,
          themePack: normalizedThemePack,
          defaultRuntimeMode: normalizedDefaultRuntimeMode,
          workflowModeDefaultsByLanguage: seededWorkflowDefaults,
          scratchpadAutoLogByLanguage: seededAutoLog,
          showStdinPanel,
          variableInspectorSurface,
          runtimeTimeoutPresetByLanguage: seededTimeoutPresets,
          showTimeoutCountdown,
          consoleRichRenderingEnabled,
          rubyRuntimePreference,
          firstWorkflowModeSwitchAcknowledged,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }
        // Seed/refresh the main-process mirror after every startup
        // rehydrate so pre-existing opt-ins survive the upgrade to the
        // RL-067 mirror path without forcing the user to toggle again.
        syncConsentMirror(state.telemetryConsent);
      },
    }
  )
);
