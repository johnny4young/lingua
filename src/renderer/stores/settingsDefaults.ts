import type { SettingsState } from '../types';
import type { WorkflowMode } from '../../shared/workflowMode';
import { BASELINE_SENSITIVE_HEADERS } from '../../shared/httpWorkspace';
import { DEFAULT_KEYMAP_PRESET_ID } from '../data/keymapPresets';
import { DEFAULT_THEME_PACK_ID } from '../data/themePacks';
import { defaultRuntimeTimeoutPresetSeed } from '../../shared/runtimeTimeoutPresets';

/**
 * RL-129 — settings seed constants + the initial-state factory, extracted
 * verbatim from `settingsStore.ts`. Pure data (plus the derived language-set
 * lookups the sanitizers consult). Leaf module — depends only on the shared
 * defaults it references, never on the store, sanitizers, or action factories.
 */

export const DEFAULT_EDITOR_FONT_FAMILY = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace";

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
export const WORKFLOW_MODE_DEFAULT_SEED: Record<string, WorkflowMode> = {
  javascript: 'scratchpad',
  typescript: 'scratchpad',
  python: 'scratchpad',
};

export const SETTINGS_WORKFLOW_MODE_LANGUAGE_SET: ReadonlySet<string> = new Set(
  Object.keys(WORKFLOW_MODE_DEFAULT_SEED)
);

/**
 * RL-020 Slice 5 — opt-in seed for the bare-expression auto-log mode.
 * JS / TS only. Default OFF so a fresh install never floods the
 * result panel with inline values until the user explicitly enables
 * the feature in Settings → Editor.
 */
export const SCRATCHPAD_AUTO_LOG_DEFAULT_SEED: Record<string, boolean> = {
  javascript: false,
  typescript: false,
};

export const SETTINGS_AUTO_LOG_LANGUAGE_SET: ReadonlySet<string> = new Set(
  Object.keys(SCRATCHPAD_AUTO_LOG_DEFAULT_SEED)
);

export const APP_LANGUAGES = ['system', 'en', 'es'] as const;

export const MAX_TOKENS_PER_COMBO = 5;
export const MAX_COMBOS_PER_SHORTCUT = 4;

/**
 * RL-097 Slice 1 — Lowercased baseline list. Used by
 * `addSensitiveHttpHeader` / `removeSensitiveHttpHeader` to refuse
 * dedup-against-baseline + immutable-baseline operations, and by the
 * rehydrate sanitizer to drop baseline names from the persisted delta.
 */
export const BASELINE_SENSITIVE_HEADERS_LC: ReadonlySet<string> = new Set(
  BASELINE_SENSITIVE_HEADERS
);

/**
 * The DATA (non-action) fields of the settings store at first boot. Extracted
 * so the assembly point stays pure wiring. The `satisfies Partial<SettingsState>`
 * validates every field against the live type while preserving the literal
 * types; completeness (no missing field) is enforced by the `create<SettingsState>`
 * assembly once the action factories are spread alongside this.
 */
export function createInitialSettingsState() {
  return {
    theme: 'dark',
    editorTheme: 'lingua-dark',
    fontSize: 14,
    fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
    wordWrap: false,
    minimap: false,
    layoutPreset: 'horizontal',
    maxLoopIterations: 10_000,
    restoreSession: false,
    formatOnSave: false,
    vimMode: false,
    nativeExecutionAcknowledged: false,
    executionHistorySnapshotEnabled: true,
    telemetryConsent: 'unset',
    utilitiesClipboardOnFocusConsent: 'unset',
    // RL-094 Slice 2 fold C — capsule-import clipboard auto-detect
    // opt-in. Sticky three-state mirror of the utilities consent.
    capsuleImportClipboardOnFocusConsent: 'unset',
    // RL-100 Slice 1 fold F — import-preview clipboard auto-detect
    // opt-in (cURL paste / drop, etc.). Sticky three-state. Slice 1
    // lands the field on the store + sanitized rehydrate; Slice 2
    // wires the actual auto-detect on overlay focus.
    importPreviewClipboardOnFocusConsent: 'unset',
    // RL-025 Slice A — master toggle for dependency detection +
    // the bottom-panel Dependencies tab. The rehydrate merge
    // applies the fold-G tier-aware default when the persisted state
    // has no preference yet (Free → false, every other tier → true).
    // Once the user persists a choice via the setter, that choice
    // survives across reloads.
    dependencyDetectionEnabled: true,
    // RL-019 Slice 1 fold B — only `worker` is implemented today;
    // the setter rejects anything else, so this stays a constant
    // initial value until Slice 2 lands the desktop Node backend.
    defaultRuntimeMode: 'worker',
    // RL-020 Slice 2 — per-language workflow defaults. Initial
    // value is the fold-C seed; the merge function preserves user
    // overrides on rehydrate and seeds missing keys.
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
    // RL-042 Slice 6 — Ruby runtime preference. `auto` is the
    // friendliest default (system when detected, WASM otherwise).
    // Sanitization in the rehydrate handler maps tampered values
    // back to this seed.
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
    // RL-097 Slice 1 — Sensitive HTTP header allowlist. Initial
    // state is empty (the baseline list in
    // `BASELINE_SENSITIVE_HEADERS` is always applied additively at
    // redaction time). Users add via Settings → Privacy → Sensitive
    // HTTP headers.
    sensitiveHttpHeaders: [],
    // RL-097 Slice 2 — SQL workspace preview cap + default timeout.
    // The runtime layer enforces `MAX_RESULT_ROWS` (10 000) +
    // `MAX_QUERY_TIMEOUT_MS` (5 min) regardless; these knobs live
    // here so users can dial them down without losing the hard
    // ceiling.
    sqlWorkspaceRowDisplayLimit: 1000,
    sqlWorkspaceQueryTimeoutMs: 30_000,
  } satisfies Partial<SettingsState>;
}
