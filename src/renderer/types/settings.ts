/**
 * Renderer settings-state contracts.
 *
 * Settings stores and consumers import this leaf directly. Keeping the large
 * persisted contract isolated prevents editor and console types from becoming
 * accidental dependencies of every settings caller.
 */

import type { BrowserPreviewRefreshInterval } from '../../shared/browserPreviewRefresh';
import type { ScorecardPlatform } from '../../shared/languageSupport';
import type { RuntimeMode } from '../../shared/runtimeModes';
import type { RuntimeTimeoutPreset } from '../../shared/runtimeTimeoutPresets';
import type { WorkflowMode } from '../../shared/workflowMode';
import type { ShortcutCombo, ShortcutOverrideMap } from '../data/keyboardShortcuts';
import type { AppLanguage } from './language';

export type LayoutPreset = 'horizontal' | 'vertical' | 'editor-only';

/**
 * internal — boot-time session-restore policy. Replaces the legacy
 * `restoreSession: boolean`. Three closed states:
 *
 *   - `never`   — ignore the persisted session snapshot; always boot fresh.
 *   - `ask`     — if the snapshot holds ≥1 tab, surface a clickable
 *                 "Restore N tabs" prompt; restore only on click. Default
 *                 for fresh installs, and the privacy-conscious middle
 *                 ground (reopening after screen-sharing does not auto-
 *                 surface private code).
 *   - `always`  — restore the snapshot silently on boot (the legacy
 *                 `restoreSession: true` behavior).
 *
 * The v1→v2 settings migration maps legacy `false → 'ask'` (implementation note —
 * everyone gets the better default) and `true → 'always'`.
 */
export type RestoreSessionMode = 'never' | 'ask' | 'always';

export interface SettingsState {
  theme: 'dark' | 'light';
  editorTheme: string;
  fontSize: number;
  fontFamily: string;
  wordWrap: boolean;
  minimap: boolean;
  layoutPreset: LayoutPreset;
  maxLoopIterations: number;
  restoreSessionMode: RestoreSessionMode;
  /** implementation — sticky Web/Desktop filter on the Language Support Scorecard. */
  languageScorecardPlatform: ScorecardPlatform;
  formatOnSave: boolean;
  /**
   * internal — master toggle for smart paste detection. When `true` (default),
   * pasting a recognized artifact (share-link, capsule, cURL, stack frame,
   * large JSON) into the editor surfaces a non-blocking import toast. When
   * `false`, every paste is literal. Cmd+Shift+V bypasses detection for a
   * single paste regardless of this flag.
   */
  smartPasteDetectionEnabled: boolean;
  /**
   * internal Vim mode flag. When `true`, the editor lazy-loads
   * `monaco-vim` and attaches Vim keybindings to the active Monaco
   * editor.
   */
  vimMode: boolean;
  /**
   * internal — once-per-install acknowledgement for the trust-boundary
   * modal that appears before the first Go/Rust native execution.
   * Persisted so the user only sees the warning until they accept;
   * resettable from Settings → Account → Privacy.
   */
  nativeExecutionAcknowledged: boolean;
  /**
   * implementation — opt-in code snapshot for the execution-history
   * ring buffer. When true (and the active tier covers
   * `EXECUTION_HISTORY`), each successful or failed run records the
   * source code at execution time so a follow-up work can offer
   * Replay / Comparison. Snapshots stay in memory only — never
   * persisted, never sent over the network. Defaults to `true` for
   * Pro users; the runtime gate in `executeTabManually` enforces the
   * tier check independently of the toggle so a state-shadowing bug
   * cannot leak captures to Free users.
   */
  executionHistorySnapshotEnabled: boolean;
  /**
   * Telemetry opt-in. Three states so we can distinguish "user explicitly
   * declined" from "user has not seen the prompt yet", and keep the prompt
   * from re-appearing after a decline.
   */
  telemetryConsent: 'unset' | 'granted' | 'declined';
  /**
   * implementation — clipboard-on-focus apply consent. Default `unset`,
   * promoted to `granted` or `declined` by the explicit Settings toggle.
   * The same three-state pattern as `telemetryConsent` so a decline
   * sticks across reloads and the feature never reads without opt-in.
   */
  utilitiesClipboardOnFocusConsent: 'unset' | 'granted' | 'declined';
  /**
   * implementation note — capsule-import clipboard auto-detect
   * consent. When the user opens the Capsule Import overlay (e.g.
   * Mod+Shift+Y), if this consent is `granted` and the system
   * clipboard contains a valid capsule JSON, the overlay pre-fills
   * the paste area. `'unset'` shows an opt-in row in the overlay
   * itself; `'declined'` keeps the clipboard untouched. Local-only;
   * the helper never reads the clipboard without explicit opt-in,
   * mirroring `utilitiesClipboardOnFocusConsent`.
   */
  capsuleImportClipboardOnFocusConsent: 'unset' | 'granted' | 'declined';
  /**
   * implementation note — import-preview clipboard auto-detect
   * consent. implementation lands the field on the store + sanitized
   * rehydrate (no Settings UI surface yet); implementation wires the
   * actual auto-detect on overlay focus, mirroring the capsule
   * import flow.
   */
  importPreviewClipboardOnFocusConsent: 'unset' | 'granted' | 'declined';
  /**
   * implementation — master toggle for the dependency detection
   * pipeline + bottom-panel Dependencies tab. Default depends on
   * tier at first rehydrate (implementation note): Free → `false` so the
   * disabled Install button never reads as upsell pressure; Pro /
   * Team / Education / Trial → `true` so the panel discovers
   * itself on the next paste. Persisted, so once the user flips it
   * the choice survives. Flipping it OFF clears the per-tab cache
   * so the panel hides immediately, not after the next edit.
   */
  dependencyDetectionEnabled: boolean;
  /**
   * implementation note — default JS/TS runtime mode for newly
   * created tabs. `'worker'` mirrors `defaultRuntimeModeFor()` and
   * stays the only implemented option until implementation lands. Settings
   * → Editor exposes the selector; the value is per-app, not
   * per-tab (each tab keeps its own choice).
   */
  defaultRuntimeMode: RuntimeMode;
  /**
   * implementation — per-language workflow-mode defaults applied to
   * NEWLY CREATED tabs. Existing tabs keep their explicit choice;
   * this map only governs new-tab seeding via `createDefaultTab`.
   * Missing keys fall through to the shared
   * `defaultWorkflowMode(language)` helper, so a sparse map is
   * sufficient — implementation note migration seeds the three Scratchpad
   * languages on upgrade so the Settings UI surfaces them visibly.
   */
  workflowModeDefaultsByLanguage: Record<string, WorkflowMode>;
  /**
   * implementation — per-language opt-in for the bare-expression
   * auto-log mode. Keys are `'javascript'` and `'typescript'` (the
   * two languages whose worker runner threads the auto-log
   * transform). Other keys are stripped on rehydrate; non-boolean
   * values are coerced to `false`. Per-tab overrides via
   * `FileTab.autoLogEnabled` (implementation note) win over this default.
   */
  scratchpadAutoLogByLanguage: Record<string, boolean>;
  /**
   * implementation — default debounce for Browser preview live refresh.
   * `0` disables automatic refresh; the two live values are 300 ms and
   * 1,000 ms. A first-line `// @preview-refresh ...` directive can override
   * this preference for one tab without mutating the persisted setting.
   */
  browserPreviewRefreshIntervalMs: BrowserPreviewRefreshInterval;
  /**
   * internal — per-language inline-lint enablement. Keyed by language id;
   * implementation ships `javascript`/`typescript` ON. When `false` for a language,
   * Monaco's built-in TS/JS squiggles are silenced (via
   * `setMonacoInlineLintEnabled`) and the custom `'lingua-lint'` markers are
   * cleared for that language. Unknown keys are stripped on rehydrate;
   * non-boolean values coerce to the seed default.
   */
  inlineLintEnabledByLanguage: Record<string, boolean>;
  /**
   * implementation note — master visibility toggle for the
   * bottom-panel `stdin` tab. Default `true` (the tab is offered
   * for JS / TS / Python tabs). When `false`, the BottomPanel
   * strip skips the entry entirely, so users who never use stdin
   * keep the leaner three-tab strip.
   */
  showStdinPanel: boolean;
  /**
   * internal — master visibility toggle for the persistent bottom status
   * bar (language, problems, cursor position, encoding, indent, Git
   * branch, run status). Default ON desktop / OFF web. When `false` the
   * bar is fully unmounted (not just hidden), so it costs nothing for
   * users who never want it.
   */
  showStatusBar: boolean;
  /**
   * implementation — controls whether the variable inspector renders as
   * a draggable `<FloatingVariablesCard>` (default) or as a Variables
   * tab inside the bottom panel. Per-tab `variableInspectorEnabled`
   * still gates visibility on both surfaces; this picks where it
   * appears when enabled.
   */
  variableInspectorSurface: 'floating' | 'bottom';
  /**
   * implementation — per-language execution timeout preset. Keys are
   * the four languages whose runners read the preset
   * (`javascript`, `typescript`, `python`, `go`). Values are the
   * closed-enum `RuntimeTimeoutPreset` tokens. Unknown keys / values
   * are stripped on rehydrate. Rust is intentionally absent — its
   * desktop child-process kill path lives in main and is unchanged.
   */
  runtimeTimeoutPresetByLanguage: Record<string, RuntimeTimeoutPreset>;
  /**
   * implementation note — show a live `mm:ss` countdown in the
   * result-panel pill while a run is in flight. Default `false` so
   * the panel stays quiet by default; users who want the visual cue
   * during long runs opt in via Settings → Editor.
   */
  showTimeoutCountdown: boolean;
  /**
   * implementation — per-line timing master toggle. When on, JS / TS
   * runs are instrumented with `__mc_tick` markers and every top-level
   * statement's wall-clock duration renders inline next to its line.
   * Default `false` (the instrumentation adds overhead); an in-buffer
   * `// @time` magic comment enables timing for that buffer regardless
   * of this setting.
   */
  showLineTiming: boolean;
  /**
   * implementation note — Settings → Editor master toggle that
   * decides whether new tabs default to having the Variables panel
   * armed. Per-tab `variableInspectorEnabled` always wins when set;
   * this is just the seed for tabs that have not been touched.
   * Default OFF — the inspector is opt-in like auto-log.
   */
  showVariableInspectorByDefault: boolean;
  /**
   * implementation note — recursion depth the workers walk when
   * serializing the scope. `1` is the base scope; `4` is the
   * shared module's cap. Default `1`. Bumping this trades worker
   * time for richer panel data — the user can change it from
   * Settings → Editor.
   */
  variableInspectorScopeDepth: number;
  /**
   * implementation — Ruby runtime dispatcher preference. `auto` (the
   * default) prefers the system `ruby` binary when detected and falls
   * back to the bundled `@ruby/wasm-wasi` worker otherwise. `system`
   * forces the desktop subprocess (still falls back to WASM with a
   * status notice if the binary is missing). `wasm` always uses the
   * worker, even on desktop. Web builds ignore `system` / `auto` and
   * always run WASM because the bridge is missing.
   */
  rubyRuntimePreference: 'auto' | 'system' | 'wasm';
  /**
   * implementation note — one-shot dismissal flag for the
   * "Node mode runs your code with full filesystem and network
   * access" trust notice. Set the first time the user successfully
   * runs a Node-mode tab; the notice does not re-surface on
   * subsequent runs. Resettable from Settings if a future work
   * surfaces the toggle.
   */
  nodeRunnerFirstRunNoticeShown: boolean;
  /**
   * implementation note — one-shot acknowledgement flag for the
   * "Scratchpad auto-runs as you type; Run waits for Cmd+R"
   * onboarding toast. Set to `true` the first time the user switches
   * a tab away from Scratchpad; the toast never re-fires after that.
   * Resettable from Settings → Account → Privacy (next slice) so
   * users can re-trigger the tour on a fresh install.
   */
  firstWorkflowModeSwitchAcknowledged: boolean;
  /**
   * implementation — onboarding choreography one-shot flags. Each
   * flag flips to `true` the first time its stage fires; resettable
   * from Settings → General → Onboarding so users can replay any
   * stage. Default `false` so a fresh install sees the full
   * sequence.
   */
  hasCompletedOnboardingWelcome: boolean;
  hasCompletedOnboardingFirstRun: boolean;
  hasCompletedOnboardingFirstSnippet: boolean;
  /**
   * implementation — seed-version tracker for the welcome scratchpad.
   * Bumping `SEEDED_SCRATCHPAD_VERSION` on a future demo improvement
   * re-arms the seed for users whose persisted value is older,
   * regardless of `hasCompletedOnboardingWelcome`.
   */
  onboardingWelcomeSeedVersion: number;
  /**
   * App locale preference. `'system'` delegates to browser/OS locale; concrete
   * values pin the UI language and are mirrored through i18next on boot.
   */
  language: AppLanguage;
  /**
   * Last product version for the "what's new" surface. `null` means the user
   * has not acknowledged any release note version yet.
   */
  lastSeenVersion: string | null;
  /**
   * Show one non-blocking What's New notice after each version upgrade.
   * The version is still acknowledged while disabled so re-enabling the
   * preference does not surface stale release notes.
   */
  whatsNewNotificationsEnabled: boolean;
  /** Show rotating, platform-safe guidance in otherwise empty product surfaces. */
  contextualHintsEnabled: boolean;
  /**
   * True once the legacy guided tour reaches its final step. Kept separate from
   * `suppressTourAutoStart` so a skipped tour can be re-enabled later.
   */
  hasCompletedTour: boolean;
  /**
   * When true, the guided tour is never auto-started on app launch. Set when
   * the user ticks "Don't show again" inside a tour step, or toggles the
   * matching switch in Settings. `hasCompletedTour` still tracks whether the
   * tour ran to the end — the two flags are intentionally independent so a
   * user who skipped can re-enable auto-start later.
   */
  suppressTourAutoStart: boolean;
  /**
   * User-defined keyboard shortcut overrides keyed by shortcut id. Missing
   * entries fall back to the catalog defaults in `keyboardShortcuts.ts`.
   * Theme preset import/export intentionally does NOT touch this map — the
   * same rationale that keeps loopProtection/restoreSessionMode out of presets.
   */
  shortcutOverrides: ShortcutOverrideMap;
  /**
   * Currently-applied keymap preset id. `default` means "no preset", i.e. the
   * catalog defaults (plus any ad-hoc overrides the user recorded). Selecting
   * a non-default preset REPLACES ad-hoc overrides with the preset's bundle.
   */
  keymapPreset: string;
  /**
   * Currently-applied theme pack id. `default` means "no pack", i.e. the
   * Lingua ship defaults. Applying a pack replaces appearance/typography/
   * layout fields wholesale; any manual edit afterwards flips this back
   * to `default` so the selector doesn't lie about the active state.
   */
  themePack: string;
  /**
   * implementation — Sensitive HTTP header allowlist. Names listed
   * here are redacted in the HTTP workspace response history + on
   * exported capsules. The baseline list
   * (`BASELINE_SENSITIVE_HEADERS` in `src/shared/httpSensitiveHeaders.ts`)
   * always applies regardless of this allowlist — users can ADD
   * names, not REMOVE the baselines. Lowercased + trimmed on
   * sanitize-on-rehydrate; non-string entries and empty strings are
   * dropped silently.
   */
  sensitiveHttpHeaders: string[];
  /**
   * implementation — SQL workspace row preview cap. Sets the upper
   * bound on rows rendered in `<SqlResultPreview>`. The runtime
   * also caps at `MAX_RESULT_ROWS` (10 000) regardless; this knob
   * lets users dial the panel further down (100 / 500 / 1000 /
   * 5000) for smaller screens. Default 1000.
   */
  sqlWorkspaceRowDisplayLimit: 100 | 500 | 1000 | 5000;
  /**
   * implementation — SQL query default timeout. DuckDB-WASM has no
   * native abort, so the runtime layer races a Promise against this
   * timeout. Default 30 s, capped at `MAX_QUERY_TIMEOUT_MS` (5 min)
   * by the runtime regardless of this value.
   */
  sqlWorkspaceQueryTimeoutMs: number;
  /**
   * implementation (SQL OPFS) — opt into persisting the SQL workspace
   * DuckDB database to this browser's OPFS so tables + rows survive a
   * reload. Default `false` (the workspace is an in-memory scratchpad).
   * The runtime falls back to in-memory whenever OPFS is unavailable,
   * so a `true` value here is a *request*, not a guarantee. Takes effect
   * on the next reload or via the Settings "Reconnect now" action.
   */
  sqlWorkspacePersistTables: boolean;
  /**
   * internal — opt into the local Run Ledger: manual runs recorded into
   * the `lingua_ledger` schema of the SQL workspace's DuckDB database.
   * It stores source hashes plus metadata-only capsule summaries; source,
   * input, output, and diagnostics never persist. Default `false`;
   * durability across reloads additionally requires the OPFS opt-in above,
   * otherwise the ledger lives for the session only.
   */
  runLedgerEnabled: boolean;
  /**
   * implementation Slice C implementation note — language seeded into a new notebook code
   * cell by the "Add code" toolbar button. Only the two runnable cell
   * languages are offered; defaults to `'javascript'`.
   */
  notebookDefaultCellLanguage: 'javascript' | 'typescript';
  setTheme: (theme: 'dark' | 'light') => void;
  setEditorTheme: (theme: string) => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  toggleWordWrap: () => void;
  toggleMinimap: () => void;
  setLayoutPreset: (preset: LayoutPreset) => void;
  setMaxLoopIterations: (max: number) => void;
  setRestoreSessionMode: (mode: RestoreSessionMode) => void;
  /** implementation — set the scorecard's Web/Desktop platform filter. */
  setLanguageScorecardPlatform: (platform: ScorecardPlatform) => void;
  toggleFormatOnSave: () => void;
  /** internal — flip the smart-paste detection master toggle. */
  toggleSmartPasteDetection: () => void;
  toggleVimMode: () => void;
  /** internal — flip the native-execution acknowledgement flag. */
  setNativeExecutionAcknowledged: (value: boolean) => void;
  toggleExecutionHistorySnapshot: () => void;
  setTelemetryConsent: (next: 'granted' | 'declined') => void;
  /** implementation — flip clipboard-on-focus consent (granted/declined). */
  setUtilitiesClipboardOnFocusConsent: (next: 'granted' | 'declined') => void;
  /**
   * implementation note — flip capsule-import clipboard consent.
   * Same `'granted' | 'declined'` discipline as the utilities consent
   * so a single Settings setter never widens the closed enum.
   */
  setCapsuleImportClipboardOnFocusConsent: (next: 'granted' | 'declined') => void;
  /**
   * implementation note — set the import-preview clipboard consent.
   * Closed enum mirrors the capsule-import + utilities setters.
   */
  setImportPreviewClipboardOnFocusConsent: (next: 'granted' | 'declined') => void;
  /** implementation — flip the dependency detection master switch. */
  toggleDependencyDetectionEnabled: () => void;
  /**
   * implementation — three reset setters wired to the Settings →
   * General → Onboarding row toggles, the `Mod+Shift+W` shortcut
   * (implementation note), and the palette commands (implementation note). Each flips the
   * corresponding `hasCompletedOnboarding*` flag back to `false`.
   * `resetOnboardingWelcome` additionally resets
   * `onboardingWelcomeSeedVersion` so the latest seed is re-applied.
   */
  resetOnboardingWelcome: () => void;
  resetOnboardingFirstRun: () => void;
  resetOnboardingFirstSnippet: () => void;
  /**
   * implementation — stage-completion setters. Called by
   * `useOnboardingChoreography` after each toast fires so the
   * stage never repeats. `markOnboardingWelcomeCompleted` also
   * stamps the seed-version tracker.
   */
  markOnboardingWelcomeCompleted: (seedVersion: number) => void;
  markOnboardingFirstRunCompleted: () => void;
  markOnboardingFirstSnippetCompleted: () => void;
  /**
   * Apply a theme preset (editor theme, shell theme, typography, layout)
   * loaded from an exported JSON document. Non-theme settings (loop
   * protection, session restore, format-on-save, ...) are intentionally
   * left untouched so preset sharing doesn't override safety preferences.
   */
  applyThemePreset: (preset: {
    theme: 'dark' | 'light';
    editorTheme: string;
    fontFamily: string;
    fontSize: number;
    layoutPreset: LayoutPreset;
  }) => void;
  setLanguage: (language: AppLanguage) => void;
  /**
   * implementation note — set the per-app default JS/TS runtime
   * mode for newly created tabs. Existing tabs keep their own
   * runtime mode; only `createDefaultTab` reads this preference.
   * Rejects (no-op) for modes that are not yet implemented.
   */
  setDefaultRuntimeMode: (mode: RuntimeMode) => void;
  /**
   * implementation Slice C implementation note — set the default language for new notebook
   * code cells. Rejects (no-op) anything outside the runnable pair.
   */
  setNotebookDefaultCellLanguage: (language: 'javascript' | 'typescript') => void;
  /**
   * implementation — set the default workflow mode for a language.
   * No-op when the language does not support the requested mode.
   * `null` clears the user override and falls back to the shared
   * `defaultWorkflowMode(language)` helper.
   */
  setWorkflowModeDefault: (language: string, mode: WorkflowMode | null) => void;
  /**
   * implementation — set the per-language default for bare-expression
   * auto-log mode. No-op for any language outside the JS / TS pair.
   * Emits `runtime.auto_log_enabled` telemetry with closed-enum
   * payload `{ language, enabled }`.
   */
  setScratchpadAutoLogDefault: (language: string, enabled: boolean) => void;
  /** implementation — set the closed Browser preview refresh interval. */
  setBrowserPreviewRefreshInterval: (intervalMs: BrowserPreviewRefreshInterval) => void;
  /**
   * internal — flip inline lint for one language. No-op for languages outside
   * the supported set ({@link SETTINGS_INLINE_LINT_LANGUAGE_SET}). Pure state
   * write; the diagnostic-adoption signal rides
   * `editor.lint_diagnostic_emitted`, not the toggle.
   */
  setInlineLintEnabled: (language: string, enabled: boolean) => void;
  /**
   * implementation note — flip the master visibility toggle for
   * the bottom-panel `stdin` tab.
   */
  toggleShowStdinPanel: () => void;
  /**
   * internal — set the master visibility toggle for the persistent bottom
   * status bar. Emits `editor.status_bar_toggled` ({ enabled }) telemetry
   * on real change only.
   */
  setShowStatusBar: (enabled: boolean) => void;
  /** implementation — switch the variable inspector surface. */
  setVariableInspectorSurface: (surface: 'floating' | 'bottom') => void;
  /**
   * implementation — set the per-language timeout preset. Rejects
   * (no-op) for languages outside the supported set
   * (`javascript`, `typescript`, `python`, `go`) and for unknown
   * preset tokens. Fires `runtime.timeout_preset_changed` telemetry
   * (implementation note) with closed-enum `{ language, preset }` payload.
   */
  setRuntimeTimeoutPreset: (language: string, preset: RuntimeTimeoutPreset) => void;
  /**
   * implementation note — flip the countdown-in-pill toggle.
   */
  toggleShowTimeoutCountdown: () => void;
  /** implementation — flip the per-line timing toggle. */
  toggleShowLineTiming: () => void;
  /** implementation — set the Ruby runtime dispatcher preference. */
  setRubyRuntimePreference: (preference: 'auto' | 'system' | 'wasm') => void;
  /**
   * implementation note — mark the workflow-mode onboarding toast
   * acknowledged. Idempotent. Called when the user explicitly
   * dismisses or just sees the toast.
   */
  acknowledgeFirstWorkflowModeSwitch: () => void;
  setLastSeenVersion: (version: string | null) => void;
  setWhatsNewNotificationsEnabled: (enabled: boolean) => void;
  setContextualHintsEnabled: (enabled: boolean) => void;
  setHasCompletedTour: (value: boolean) => void;
  setSuppressTourAutoStart: (value: boolean) => void;
  setShortcutOverride: (id: string, combos: readonly ShortcutCombo[]) => void;
  clearShortcutOverride: (id: string) => void;
  resetShortcutOverrides: () => void;
  /**
   * implementation — Add a header name to the sensitive-headers
   * allowlist. Lowercases + trims before insert; dedupes against
   * the BASELINE list and the existing user list (no-op when
   * already present).
   */
  addSensitiveHttpHeader: (name: string) => void;
  /**
   * implementation — Remove a USER-added header name from the
   * allowlist. The baseline list is immutable from this seam;
   * attempts to remove a baseline name no-op silently.
   */
  removeSensitiveHttpHeader: (name: string) => void;
  /**
   * implementation — Update the SQL row display cap. Setter accepts
   * any of the four canonical values; unknown values clamp to the
   * default 1000.
   */
  setSqlWorkspaceRowDisplayLimit: (value: 100 | 500 | 1000 | 5000) => void;
  /**
   * implementation — Update the SQL query default timeout in
   * milliseconds. Setter clamps to `MAX_QUERY_TIMEOUT_MS` (5 min)
   * and floors at 1 s; non-finite values reset to the 30 s default.
   */
  setSqlWorkspaceQueryTimeoutMs: (value: number) => void;
  /**
   * implementation (SQL OPFS) — toggle SQL workspace table persistence.
   * Coerces non-boolean inputs to `false`. The change applies to the
   * next DuckDB instantiate (reload or "Reconnect now"); the live engine
   * is not migrated mid-session.
   */
  setSqlWorkspacePersistTables: (value: boolean) => void;
  /** internal — toggle the local Run Ledger (see `runLedgerEnabled`). */
  setRunLedgerEnabled: (value: boolean) => void;
  /**
   * Apply a named keymap preset. Replaces `shortcutOverrides` with the
   * preset's bundle and stores the preset id. Unknown ids are ignored so
   * a malformed persisted preset can't leave the store in a bad shape.
   */
  applyKeymapPreset: (presetId: string) => void;
  /**
   * Apply a named theme pack. Replaces appearance/typography/layout fields
   * with the pack's bundle and stores the pack id. Unknown ids are ignored.
   * Does not touch safety/workflow prefs (loopProtection, restoreSessionMode,
   * formatOnSave) — same rationale as `applyThemePreset`.
   */
  applyThemePack: (packId: string) => void;
}
