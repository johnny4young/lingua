/**
 * Privacy-respecting telemetry payload shape + redactor (RL-065).
 *
 * The product is local-first; telemetry only fires when the user has
 * explicitly opted in and the build honors the `VITE_LINGUA_TELEMETRY_DISABLED=1`
 * kill switch. This module owns the TypeScript surface for telemetry events
 * and, critically, the `TELEMETRY_EVENTS` allowlist that prevents drift
 * into "just this one field" expansions that creep toward user code capture.
 *
 * `redactForTelemetry` is exported so both the renderer emitter and the
 * CI payload grep live on the same single redaction pass.
 */

export const TELEMETRY_EVENTS = [
  'app.launched',
  'runner.executed',
  'overlay.opened',
  'feature.blocked',
  'update.checked',
  // RL-069 Slice 3 — Developer Utilities productivity layer adoption.
  // Counts only; no content, no input/output payloads, no tool ids
  // beyond a fixed enum bucket already on the catalog.
  'utility.favorite.pinned',
  'utility.history.cleared',
  'utility.clipboard.applied',
  // RL-027 Slice 1.5 — debugger session lifecycle. Payload is locked to
  // `{ language, reasonBucket }` per DEBUGGER_ADR §4. No source, no code,
  // no expression content, no breakpoint coordinates.
  'debugger.attached',
  'debugger.paused',
  'debugger.detached',
  // RL-019 Slice 1 — per-tab JS/TS runtime mode change. Closed enum
  // payload `{ mode, language }`; no source, no tab id, no content.
  // See `docs/RUNTIME_MODES_ADR.md` for the policy.
  'runtime.mode_changed',
  // RL-020 Slice 1 — auto-run completion gate fired. Closed enum
  // payload `{ language, reason }`; no source, no tab id, no content.
  // Today only `reason: 'incomplete'` ships; the validator is locked
  // to that single value so a future expansion of the gate must
  // amend this allowlist + the mirror in update-server.
  'runtime.auto_run_gated',
  // RL-020 Slice 8 — Compare-with-last-stable adoption signal.
  // Closed-enum payload `{ language, enabled }`; no source code,
  // no tab id, no diff content. Fires on user-driven toggles (the
  // header button, the palette action, the Mod+Shift+D shortcut).
  // The flag flips both ways so dashboards can see enable vs.
  // disable separately.
  'runtime.compare_view_toggled',
  // RL-020 Slice 2 — per-tab workflow mode change. Closed enum
  // payload `{ language, from, to, trigger }`; no source code, no
  // tab id, no content. `from` + `to` are the WorkflowMode enum;
  // `trigger` tags what caused the change (toolbar click vs. the
  // language-change auto-correction in renameTab). Property is
  // named `trigger` (not `source`) so the DENY_SUBSTRINGS pass
  // does not strip it on the way out.
  'runtime.workflow_mode_changed',
  // RL-020 Slice 3 — magic-comment results emitted. Closed enum
  // payload `{ language, hasArrow, hasWatch }`; no expression
  // content, no line numbers, no values. Fired at most once per
  // debounced auto-run when at least one magic result reached the
  // panel, so adoption of `//=>` vs `// @watch` is observable
  // without per-comment noise.
  'runtime.magic_comment_emitted',
  // RL-020 Slice 4 — execution-history replay dispatched. Closed
  // enum payload `{ language, status, surface }`; no source code,
  // no expression content, no timestamp. `surface` tags WHICH UI
  // surface drove the replay (`tab_pill`, `palette`, `popover`) so
  // adoption per affordance is observable. Fired once per replay
  // dispatch, gated by the same EXECUTION_HISTORY entitlement that
  // controls the replay surfaces.
  'runtime.history_replay',
  // RL-020 Slice 5 — bare-expression auto-log mode adoption.
  // `runtime.auto_log_enabled` fires when the user toggles the
  // per-language Settings default (`{ language, enabled }`). The
  // event ALSO fires from the per-tab override path so adoption is
  // observable regardless of which surface the user used to flip
  // the bit. `enabled` is a boolean.
  'runtime.auto_log_enabled',
  // RL-020 Slice 5 fold A — per-run auto-log emission signal. Fires
  // at most once per clean auto-run that produced ≥1 auto-log
  // result. `countBucket` is a closed enum (`1`, `2-5`, `6-20`,
  // `20-plus`) so the redactor never has to accept raw counts.
  'runtime.auto_log_emitted',
  // RL-020 Slice 6 — bare-stdin adoption signal. Fires once per
  // run whose worker consumed ≥1 line from the pre-set stdin
  // buffer. Closed-enum payload: `{ language }`; no buffer
  // content, no consumed count, no source. The countBucket lives
  // on the panel only, not on the wire.
  'runtime.stdin_used',
  // RL-019 Slice 2 — desktop Node child-spawn runner adoption.
  // Fires once per `node` mode execute() with the final status
  // bucket. Closed-enum payload `{ language, status }`; no source,
  // no exit code, no error message. `status` is the closed enum
  // `'success'` / `'error'` / `'timeout'` / `'stopped'` /
  // `'missing-binary'`.
  'runtime.node_runner_used',
  // RL-020 Slice 7 — per-language timeout-preset change. Fires
  // when the user sets a new preset via Settings → Editor or via
  // the command palette. Closed-enum payload `{ language, preset }`;
  // no source code, no tab id, no content. `preset` is the
  // `RuntimeTimeoutPreset` closed enum.
  'runtime.timeout_preset_changed',
  // RL-020 Slice 9 — variable inspector adoption signal. Fires
  // when the user opens the inspector via any surface (header
  // toggle, palette action, keyboard shortcut). Closed-enum
  // payload `{ language, variableCount }`; `variableCount` is a
  // bucket string from `VARIABLE_COUNT_BUCKETS` (`'0'` / `'1-5'`
  // / `'6-20'` / `'21-50'` / `'51+'`).
  'runtime.variable_inspector_opened',
  // RL-093 Slice 3 fold F — adoption signal for the floating ↔ bottom
  // surface choice. Closed-enum payload `{ surface }` where `surface`
  // is `'floating'` or `'bottom'`. Mirrored on update-server (deferred
  // to a follow-up — see RL-093 Slice 3 Status Update in PLAN.md).
  'runtime.variable_inspector_surface_changed',
  // RL-044 Slice 1B — rich console payload rendered. Fires at most once
  // per console entry first-render so adoption per payload kind is
  // observable. Closed-enum payload `{ kind }` from
  // `CONSOLE_RICH_KIND_BUCKETS`. No source code, no expression
  // content, no per-entry counts. Mirrored on update-server with a
  // parity test.
  'runtime.console_rich_rendered',
  // RL-044 Slice 1B fold F — `console.table()` shim adoption signal.
  // Separate from `runtime.console_rich_rendered` so a dashboard can
  // count discovery of the explicit shim (vs. auto-detection of
  // tabular arrays by `serializeRichValue`). Closed-enum payload
  // `{ language }` only.
  'runtime.console_table_called',
  // RL-044 Sub-slice G.1 Fold D — Fold G inverse direction adoption.
  // Fires when the editor cursor settles on a line that matches at
  // least one console row's `origin.line` and the `<ConsolePanel>`
  // pulse listener actually paints. Closed-enum `{ language }`
  // (`isSafeToken`) only — no line numbers, no file paths. Lets us
  // measure adoption of the inverse direction independently from the
  // `runtime.output_origin_clicked` badge metric: a low ratio
  // (cursor_pulse / output_origin) means users only click the chip
  // and don't notice the symmetric editor→console pulse.
  'runtime.cursor_pulse_emitted',
  // RL-044 Slice 1C fold B — Python (Pyodide) console payload adoption
  // signal. Separate from the renderer-side
  // `runtime.console_rich_rendered` so dashboards can isolate
  // Python-runner-produced payloads from the renderer's render
  // dispatch. Closed-enum `{ kind }` mirrors `CONSOLE_RICH_KIND_BUCKETS`.
  'runtime.python_console_payload_emitted',
  // RL-044 Slice 2a — Sub-slice F adoption signal. Fires once per
  // click on a clickable stack frame. Closed-enum `{ language }`
  // only; no file, no line, no column, no function name. Mirrored on
  // update-server.
  'runtime.error_stack_frame_clicked',
  // RL-044 Slice 2a — rich-media payload rejection signal. Useful for
  // security dashboards: counts how often workers (or user-emitted
  // payloads) get bounced by the renderer-side validators. Closed
  // enum `{ kind, reason }`: `kind` ∈ `{'image','html','chart'}`,
  // `reason` ∈ `{'invalid-src','size-limit','validation-failed'}`.
  // No source, no payload content. Mirrored on update-server.
  'runtime.rich_media_payload_rejected',
  // RL-044 Slice 2b-β-β-α fold E — Python-side `__lingua.chart/image/html`
  // adoption signal. Separate from `runtime.python_console_payload_emitted`
  // (which fires for any payload kind including auto-promoted table /
  // object from the print override) so the security dashboard can
  // isolate explicit user-emitted rich media. Closed-enum `{ kind }`
  // matches `RICH_MEDIA_REJECTED_KINDS`. Mirrored on update-server
  // with a parity test.
  'runtime.python_rich_media_used',
  // RL-042 Slice 6 — Ruby runtime dispatch signal. Fires on every
  // `RubyRunner.execute()` so dashboards can isolate the WASM-only
  // path from the system-binary path. Closed-enum payload
  // `{ mode, bucketedSpawnMs }` — `mode` is `'system'` / `'wasm'` /
  // `'missing'` (system requested but not detected), `bucketedSpawnMs`
  // is `'<100ms'` / `'<300ms'` / `'<1s'` / `'<3s'` / `'>=3s'`. No
  // source code, no file path, no IPC payload content. Mirrored on
  // update-server with a parity test.
  'runtime.ruby_runner_dispatched',
  // RL-042 Slice 6 — adoption signal for the Settings → Editor
  // "Ruby runtime" select. Closed-enum payload `{ preference }`
  // matching the persisted `rubyRuntimePreference` enum.
  'runtime.ruby_runtime_preference_changed',
  // RL-024 Slice 1 — fires once per session (debounced) when the web
  // build calls `selectDirectory()` but `window.showDirectoryPicker`
  // is unavailable (Safari, older Firefox). Closed-enum payload
  // `{ userAgentBucket }`. Lets us count how many users hit the
  // "Open folder" wall on browsers without File System Access API
  // before we promote a richer fallback. Mirrored on update-server.
  'runtime.fs_directory_picker_unsupported',
  // RL-094 Slice 1 fold A — adoption signal for the Run Capsule
  // export surface. Closed-enum `{ trigger, sizeBucket }` where
  // `trigger ∈ {'settings-export', 'palette-export'}` and
  // `sizeBucket ∈ CAPSULE_SIZE_BUCKETS`. No source content, no
  // capsuleId, no environment leaks. Mirrored on update-server with
  // a parity test.
  'capsule.exported',
  // RL-095 Slice 1 fold A — adoption signal for the Language Support
  // Scorecard. Closed-enum `{ surface }` where surface distinguishes
  // the surface that drove discovery ('settings' = Settings tab
  // scroll-into-view, 'palette' = command palette "Show language
  // support"). Once-per-session per surface guard. Mirrored on
  // update-server with parity test. The property key is `surface`
  // (not `source`) because the DENY_SUBSTRINGS pass below strips any
  // key whose lowercased name contains 'source' — same precedent as
  // `runtime.workflow_mode_changed { trigger }`.
  'language_scorecard_viewed',
  // RL-036 Phase A1 fold B + G — share-link creation. Closed-enum
  // `{ trigger, status, sizeBucket }` where trigger ∈ SHARE_CREATE_TRIGGERS
  // (button / palette / shortcut), status ∈ SHARE_CREATE_STATUSES
  // (success / too-large / unknown-language / cancelled), sizeBucket
  // ∈ SHARE_SIZE_BUCKETS. NO source content, NO encoded fragment, NO
  // URL — only the size bucket and the qualitative outcome. Mirrored
  // on update-server with parity test.
  'share.created',
  // RL-036 Phase A1 fold B + G — share-link import (open from URL).
  // Closed-enum `{ status, sizeBucket }`. status discriminates the
  // import outcome (success / decode-fail / unknown-language /
  // unknown-version / oversized). sizeBucket is bucketed from the
  // raw fragment length BEFORE decode succeeds. Mirrored on
  // update-server with parity test.
  'share.opened',
  // RL-101 Slice 1 — onboarding choreography events. All three are
  // mirrored on update-server with parity test. Closed enums live
  // in `ONBOARDING_TOAST_STAGES` + `ONBOARDING_DISMISS_MODES`
  // (fold B) below. `language` is validated against the existing
  // `LANGUAGE_PACK_IDS` set so the redactor's DENY_SUBSTRINGS pass
  // does not strip the value — `language` is not in the deny list.
  'onboarding.first_run_completed',
  'onboarding.first_snippet_saved',
  'onboarding.toast_dismissed',
  // RL-101 Slice 1.5 fold A — production diagnostic for the toast
  // clobber bug found in the Slice 1 reviewer pass. Fires when an
  // incoming `'normal'`-priority notice push is refused because an
  // outstanding `'high'`-priority onboarding toast is still visible.
  // Closed-enum `{ outstandingStage }` so we can correlate clobber
  // attempts with the onboarding stage that survived. NO caller
  // identity, NO error text — only the qualitative outcome.
  'onboarding.toast_clobbered',
  // RL-096 Slice 1 fold A — adoption signal for the Privacy + Trust
  // dashboard. Closed-enum `{ surface }` where surface ∈
  // `PRIVACY_DASHBOARD_SURFACES` (`'settings'` for the rail click,
  // `'palette'` for the command-palette entry). Once-per-mount.
  // Mirrored on update-server with parity test.
  'privacy.dashboard_opened',
  // RL-025 Slice A — per-cycle adoption signal for the dependency
  // detection runner. Fires after each completed detect+classify
  // pass. Closed-enum `{ language, countBucket }` where countBucket
  // ∈ DEPENDENCY_COUNT_BUCKETS_SET (mirrors
  // `src/shared/dependencies/types.ts` DEPENDENCY_COUNT_BUCKETS).
  // NO package names, NO file paths, NO content. Mirrored on
  // update-server with parity test.
  'dependency.detected_in_tab',
  // RL-025 Slice A — once-per-(tab, language)-per-session signal
  // marking the first time the Dependencies panel surfaced a row
  // for that combination. Closed-enum `{ language }`. Lets us
  // measure how many fresh tabs ever surface a dependency vs how
  // many stay empty.
  'dependency.banner_shown',
  // RL-025 Slice A fold F — once-per-(tab, language)-per-session
  // rollup of the classification result. Bucketed counts per status
  // so dashboards can see whether web users are constantly hitting
  // `needs-desktop`. Closed-enum buckets share the
  // DEPENDENCY_COUNT_BUCKETS set used by `detected_in_tab` so the
  // parity test only needs to validate one enum.
  'dependency.classifications_summary',
  // RL-025 Slice B — JS/TS desktop install batch fired. Closed-enum
  // `{ language, countBucket }` where countBucket reuses the existing
  // DEPENDENCY_COUNT_BUCKETS bucketer (1 / 2-5 / 6-10 / >10). Counts
  // are bucketed at the renderer before the validator sees them, so
  // the redactor never accepts raw integers. NO package names, NO
  // file paths, NO npm stderr. One event per click batch (fold-B
  // coalescing means one event covers N specifiers).
  'dependency.install_started',
  // RL-025 Slice B — install batch terminated. Closed-enum
  // `{ language, outcome }` from DEPENDENCY_INSTALL_OUTCOMES.
  // `partial` covers the mixed case where some installs succeeded
  // and others failed inside the same batch.
  'dependency.install_completed',
  // RL-025 Slice B — failure-reason rollup. Fires at most once per
  // failed / partial batch with the dominant DEPENDENCY_INSTALL_FAILURE_REASON.
  // Separate from `install_completed` so dashboards can split network
  // errors (`exit-nonzero`) from policy refusals (`no-package-json`,
  // `invalid-specifier`) without inferring from the outcome alone.
  // NO npm stderr text, NO exit code value — only the closed enum.
  'dependency.install_failed_reason',
  // RL-044 Sub-slice G — output→source line affordance click. Fires
  // once when the user clicks an `<OutputLineBadge>` chip on a
  // console row. Closed-enum `{ language, surface }` where `surface` ∈
  // `OUTPUT_ORIGIN_SURFACES` (`'badge'` only today; the symmetric
  // hover direction does NOT emit a telemetry event because the
  // discovery surface is the badge click). Fold B throttles the
  // emit to 1 per 1000ms per `(language, surface)` bucket so a user
  // clicking 20 chips in a debugging burst produces ~2 events rather
  // than 20. No file, no line, no column — the line integer would
  // leak nothing per the redactor, but the closed allowlist keeps
  // the surface tight. Mirrored on update-server with parity test.
  'runtime.output_origin_clicked',
  // RL-102 Slice 1 fold D — Git read-only layer attachment signal.
  // Fires at most once per project root mount with the detected
  // posture. Closed-enum `{ repoState }` ∈ `GIT_LAYER_REPO_STATES`
  // (`'git-repo'` / `'no-git'` / `'no-binary'`). Useful so dashboards
  // can see what fraction of opened folders surface a usable git
  // posture; raw repo paths, branch names, and commit ids never
  // leave the device.
  'git.layer_attached',
  // RL-102 Slice 1 fold D — Git diff panel discovery signal. Fires
  // once when the user opens the bottom-panel Git diff tab (mount).
  // Pure counter — no payload, no file path, no diff content. Lets
  // us measure whether the diff panel is being used or whether the
  // pill alone carries the surface. Mirrored on update-server.
  'git.diff_panel_opened',
  // RL-102 Slice 2 — Branch / HEAD-change signal. Fires when the
  // main-side `.git/HEAD` watcher detects a settled change AND the
  // branch name actually differs from the previous cache (commit-
  // only updates are silent). Closed-enum
  // `{ repoState, branchChanged }` where `repoState` reuses
  // `GIT_LAYER_REPO_STATES` and `branchChanged` is a boolean. NO
  // branch names, NO commit hashes — the boolean keeps the signal
  // useful without leaking working-tree state. Mirrored on
  // update-server.
  'git.head_changed',
  // RL-102 Slice 2 — Reveal-in-Source-Control click. Fires when
  // the user clicks the right-click context-menu row that opens
  // the repo working tree in the OS file manager. Closed-enum
  // `{ target }` where `target ∈ REVEAL_IN_SC_TARGETS`. Today the
  // only valid target is `'repo-root'`; the closed enum stays
  // future-proof for Slice 3+ extensions. Mirrored on update-server
  // with parity test.
  'git.reveal_in_source_control_clicked',
  // RL-102 Slice 2 fold E — External-modification reload outcome.
  // Fires when the user clicks the Reload action on the
  // "File changed on disk" status notice (or rejects it). Closed-
  // enum `{ mode }` ∈ `EXTERNAL_RELOAD_MODES`
  // (`'user-accepted'` / `'user-rejected'` / `'auto-applied'`).
  // The `'auto-applied'` slot is reserved for a future
  // auto-reload-clean-tabs surface; the renderer never emits it
  // today. NO file path, NO content delta. Mirrored on update-server.
  'git.external_modification_reload',
  // RL-103 Slice 1 fold B — Curated project template applied. Fires
  // once per successful multi-file scaffold (after the entry file
  // opens in a new tab). Closed-enum payload
  // `{ templateId, language }` where `templateId` ∈
  // `TEMPLATE_PROJECT_IDS` and `language` is the language-pack id.
  // No file paths, no destination directory, no content. Mirrored
  // on update-server with parity test.
  'template_project_applied',
  // RL-024 Slice 2 — Replace in files applied. Fires once per
  // `applyToFile` AND once per `applyToAll` invocation with the
  // batch result. Closed-enum `{ scope, countBucket, regex }` where
  // `scope` ∈ REPLACE_IN_FILES_SCOPES (`'single-file'` /
  // `'all-files'`), `countBucket` reuses DEPENDENCY_COUNT_BUCKETS
  // (`'0'` / `'1'` / `'2-5'` / `'6-10'` / `'>10'`) to avoid raw
  // replacement counts on the wire, `regex` is a boolean flag
  // capturing whether the user toggled the Regex option. NO file
  // paths, NO query / replacement content. Mirrored on update-server
  // with parity test.
  'editor.replace_in_files_applied',
] as const;
export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];

export interface TelemetryBaseFields {
  appVersion: string;
  osBucket: string;
  /** `pro` / `free` / `grace` / `invalid` — never the raw token. */
  licenseStatus: string;
  /** Coarse session id generated per-launch — not a user identifier. */
  sessionId: string;
}

export interface TelemetryEvent extends TelemetryBaseFields {
  event: TelemetryEventName;
  /**
   * Allowed per-event properties. Keys listed here are the only ones that
   * survive the redactor. Any key not in this map is dropped, not sent.
   */
  properties: Record<string, string | number | boolean>;
  /** Milliseconds since epoch — rounded to the minute to reduce fingerprintability. */
  timestamp: number;
}

/**
 * Allowlist of properties we intentionally collect per event. Any other key
 * is dropped by the redactor. Keep this list short and reviewed — any
 * expansion should come with a matching copy block in the consent UI.
 */
const EVENT_PROPERTY_ALLOWLIST: Record<TelemetryEventName, readonly string[]> = {
  'app.launched': ['platform', 'build', 'locale'],
  'runner.executed': ['language', 'status', 'durationBucketMs'],
  'overlay.opened': ['overlayId'],
  'feature.blocked': ['entitlement', 'tier'],
  // RL-065 Slice 5 — `status` is a closed enum:
  //   `available`  → autoupdater reported an update is ready/downloading.
  //   `no-update`  → autoupdater reported the build is already current.
  //   `failure`    → autoupdater raised an error during the check.
  // No version strings, no release notes, no error messages — those
  // would be free-form text and risk leaking host detail. Fired by
  // `src/renderer/stores/updateStore.ts` on every transition out of
  // the `checking` state.
  'update.checked': ['status'],
  // RL-069 Slice 3 — `utilityId` is the catalog enum value (a fixed
  // string set, not user data). `count` is the post-action favorites
  // length so we can see adoption without tracking per-tool.
  'utility.favorite.pinned': ['utilityId', 'count'],
  'utility.history.cleared': ['utilityId', 'scope'],
  'utility.clipboard.applied': ['utilityId'],
  // RL-027 Slice 1.5 — `language` is the runtime adapter id (a closed
  // enum: `js` / `python` / `go` / `rust`). `reasonBucket` is a closed
  // set partitioned by event:
  //   `debugger.attached` → `attach` (the only valid value today; if a
  //     future slice adds a reattach path it MUST update this comment
  //     and the runbook in `docs/DEBUGGER_SLICE1.md`).
  //   `debugger.paused`   → `user-breakpoint` / `step` / `exception`.
  //   `debugger.detached` → `user-detach` / `run-complete` / `crash` / `stop`.
  // No expression content, no breakpoint line, no source snippet.
  'debugger.attached': ['language', 'reasonBucket'],
  'debugger.paused': ['language', 'reasonBucket'],
  'debugger.detached': ['language', 'reasonBucket'],
  // RL-019 Slice 1 — `mode` is the closed `RuntimeMode` enum
  // (`worker` / `node` / `browser-preview`). `language` is the
  // language-pack id; today only `javascript` / `typescript` ever
  // fires this event but the value-validator stays generic so
  // future slices can extend the runtime-mode surface to other
  // languages without an allowlist churn.
  'runtime.mode_changed': ['mode', 'language'],
  // RL-020 Slice 1 — `language` is the language-pack id (today only
  // `javascript` / `typescript`). `reason` is a closed enum locked
  // to `'incomplete'` for Slice 1.
  'runtime.auto_run_gated': ['language', 'reason'],
  // RL-020 Slice 8 — `language` is the language-pack id
  // (`isSafeToken`); `enabled` is a boolean flipping with the
  // user's toggle direction. Mirrored on update-server.
  'runtime.compare_view_toggled': ['language', 'enabled'],
  // RL-020 Slice 2 — `language` is the language-pack id (any
  // string passing `isSafeToken`). `from` + `to` are the
  // `WorkflowMode` closed enum (`run` / `debug` / `scratchpad`).
  // `trigger` is a closed enum tagging what caused the change:
  // `'toolbar'` — explicit segmented-control click; `'language_change'`
  // — the user renamed a tab and the previous mode is no longer
  // supported, so the store auto-corrected to a valid default. The
  // field is named `trigger` (not `source`) because the DENY_SUBSTRINGS
  // pass below treats `source` as a code-bearing flag and would strip
  // it even though the value is a closed enum.
  'runtime.workflow_mode_changed': ['language', 'from', 'to', 'trigger'],
  // RL-020 Slice 3 — `language` is the language-pack id (any
  // `isSafeToken` string). `hasArrow` and `hasWatch` are booleans
  // surfacing which magic-comment shapes fired this run. The
  // validator allows only true / false values; integers or strings
  // are dropped silently.
  'runtime.magic_comment_emitted': ['language', 'hasArrow', 'hasWatch'],
  // RL-020 Slice 4 — `language` is the language-pack id; `status`
  // is the closed `ExecutionStatus` enum (`ok` / `error`);
  // `surface` is the closed `HistoryReplaySurface` enum (see
  // `HISTORY_REPLAY_SURFACES` below).
  'runtime.history_replay': ['language', 'status', 'surface'],
  // RL-020 Slice 5 — `language` is the language-pack id (JS / TS
  // for the Slice 5 surfaces; the validator stays generic so a
  // future widening to Python does not require an allowlist
  // change). `enabled` is a boolean.
  'runtime.auto_log_enabled': ['language', 'enabled'],
  // RL-020 Slice 5 fold A — `countBucket` is the closed enum
  // (`1`, `2-5`, `6-20`, `20-plus`) emitted by `bucketAutoLogCount`
  // in `useAutoRun.ts`. The renderer / worker validators reject
  // anything else.
  'runtime.auto_log_emitted': ['language', 'countBucket'],
  // RL-020 Slice 6 — language-only payload. Bucketed counts would
  // give the consumed-line distribution but also risk fingerprinting
  // a small population by per-run shape; Slice 6 stays at adoption
  // level only.
  'runtime.stdin_used': ['language'],
  // RL-019 Slice 2 — `language` is the language-pack id
  // (`'javascript'` / `'typescript'`); `status` is the closed enum
  // (`'ok'` / `'error'` / `'timeout'` / `'stopped'` /
  // `'missing-binary'`). Mirrored on update-server.
  'runtime.node_runner_used': ['language', 'status'],
  // RL-020 Slice 7 — `language` is the language-pack id (`isSafeToken`);
  // `preset` is the closed `RuntimeTimeoutPreset` enum
  // (`quick` / `normal` / `long` / `extended`). Mirrored on
  // update-server; the parity test asserts both sets stay aligned.
  'runtime.timeout_preset_changed': ['language', 'preset'],
  // RL-020 Slice 9 — `language` is the language-pack id (`isSafeToken`);
  // `variableCount` is a closed enum bucket
  // (`'0'` / `'1-5'` / `'6-20'` / `'21-50'` / `'51+'`).
  'runtime.variable_inspector_opened': ['language', 'variableCount'],
  // RL-093 Slice 3 fold F — `surface` is the closed `'floating' | 'bottom'`
  // enum.
  'runtime.variable_inspector_surface_changed': ['surface'],
  // RL-044 Slice 1B — `kind` is the closed `ConsolePayloadKindBucket`
  // enum (`table` / `object` / `array` / `mapSet` / `date` / `promise`
  // / `text` / `rawText` / `image` / `chart`). Mirrored on
  // update-server.
  'runtime.console_rich_rendered': ['kind'],
  // RL-044 Slice 1B fold F — `language` is the language-pack id.
  // Mirrored on update-server.
  'runtime.console_table_called': ['language'],
  // RL-044 Sub-slice G.1 Fold D — `language` is the language-pack id
  // (`isSafeToken`). No line / file / payload. Mirrored on
  // update-server.
  'runtime.cursor_pulse_emitted': ['language'],
  // RL-044 Slice 1C fold B — `kind` is the closed `ConsolePayloadKindBucket`
  // enum (same set as `runtime.console_rich_rendered`).
  'runtime.python_console_payload_emitted': ['kind'],
  // RL-044 Slice 2a — `language` is the language-pack id
  // (`isSafeToken`). No file, no line, no column.
  'runtime.error_stack_frame_clicked': ['language'],
  // RL-044 Slice 2a — `kind` ∈ `RICH_MEDIA_REJECTED_KINDS`,
  // `reason` ∈ `RICH_MEDIA_REJECTED_REASONS`. Both closed enums
  // mirrored on update-server with a parity test.
  'runtime.rich_media_payload_rejected': ['kind', 'reason'],
  // RL-044 Slice 2b-β-β-α fold E — `kind` ∈ `RICH_MEDIA_REJECTED_KINDS`
  // (chart / image / html). Mirrors update-server with a parity test.
  'runtime.python_rich_media_used': ['kind'],
  // RL-042 Slice 6 — `mode` is the closed `RubyDispatchedMode`
  // (`system` / `wasm` / `missing`); `bucketedSpawnMs` is the closed
  // bucket enum (`<100ms` / `<300ms` / `<1s` / `<3s` / `>=3s`).
  // Mirrored on update-server with a parity test.
  'runtime.ruby_runner_dispatched': ['mode', 'bucketedSpawnMs'],
  // RL-042 Slice 6 — `preference` is the closed
  // `rubyRuntimePreference` enum (`auto` / `system` / `wasm`).
  // Mirrored on update-server.
  'runtime.ruby_runtime_preference_changed': ['preference'],
  // RL-024 Slice 1 — `userAgentBucket` ∈
  // `FS_DIRECTORY_PICKER_UA_BUCKETS`.
  'runtime.fs_directory_picker_unsupported': ['userAgentBucket'],
  // RL-094 Slice 1 fold A — `trigger` ∈ `CAPSULE_EXPORT_TRIGGERS`,
  // `sizeBucket` ∈ `CAPSULE_SIZE_BUCKETS`. Both closed enums.
  'capsule.exported': ['trigger', 'sizeBucket'],
  // RL-095 Slice 1 fold A — `surface` ∈ `LANGUAGE_SCORECARD_SURFACES`.
  'language_scorecard_viewed': ['surface'],
  // RL-036 Phase A1 fold B + G — `trigger` ∈ `SHARE_CREATE_TRIGGERS`,
  // `status` ∈ `SHARE_CREATE_STATUSES`, `sizeBucket` ∈
  // `SHARE_SIZE_BUCKETS_SET`.
  'share.created': ['trigger', 'status', 'sizeBucket'],
  // RL-036 Phase A1 fold B + G — `status` ∈ `SHARE_OPEN_STATUSES`,
  // `sizeBucket` ∈ `SHARE_SIZE_BUCKETS_SET`.
  'share.opened': ['status', 'sizeBucket'],
  // RL-101 Slice 1 — `language` ∈ `LANGUAGE_PACK_IDS` (existing
  // shared set; passes the redactor's DENY_SUBSTRINGS pass because
  // `language` is not in the deny list).
  'onboarding.first_run_completed': ['language'],
  // No fields: a single counter event marking the first ever snippet
  // save. Pure adoption signal, no qualifier needed.
  'onboarding.first_snippet_saved': [],
  // RL-101 fold B — `stage` ∈ `ONBOARDING_TOAST_STAGES`,
  // `dismissMode` ∈ `ONBOARDING_DISMISS_MODES`.
  'onboarding.toast_dismissed': ['stage', 'dismissMode'],
  // RL-101 Slice 1.5 fold A — `outstandingStage` ∈
  // `ONBOARDING_TOAST_STAGES`.
  'onboarding.toast_clobbered': ['outstandingStage'],
  // RL-096 Slice 1 fold A — `surface` ∈ `PRIVACY_DASHBOARD_SURFACES`.
  'privacy.dashboard_opened': ['surface'],
  // RL-025 Slice A — `language` is the adapter id (any `isSafeToken`
  // string; the set widens with Slice B/C). `countBucket` is a
  // closed-enum bucket from `DEPENDENCY_COUNT_BUCKETS_SET`.
  'dependency.detected_in_tab': ['language', 'countBucket'],
  // RL-025 Slice A — `language` only; once-per-session per
  // (tab, language) so adoption is visible without per-cycle noise.
  'dependency.banner_shown': ['language'],
  // RL-025 Slice A fold F — bucketed rollup per (tab, language) per
  // session. Four bucketed fields named `${status}Bucket` so the
  // redactor's closed-enum validator stays simple. The deny-list
  // pass treats none of these names as sensitive.
  'dependency.classifications_summary': [
    'language',
    'detectedBucket',
    'installedBucket',
    'needsDesktopBucket',
    'unsupportedBucket',
  ],
  // RL-025 Slice B — install lifecycle events. `language` is the
  // adapter id (`isSafeToken`); `countBucket` reuses the existing
  // DEPENDENCY_COUNT_BUCKETS_SET. `outcome` ∈ DEPENDENCY_INSTALL_OUTCOMES;
  // `reason` ∈ DEPENDENCY_INSTALL_FAILURE_REASONS.
  'dependency.install_started': ['language', 'countBucket'],
  'dependency.install_completed': ['language', 'outcome'],
  'dependency.install_failed_reason': ['language', 'reason'],
  // RL-044 Sub-slice G — `language` is the language-pack id
  // (`isSafeToken`); `surface` ∈ `OUTPUT_ORIGIN_SURFACES` (`'badge'`).
  // The hover path does NOT emit so this allowlist intentionally
  // omits a `'hover'` value today; widening would require an
  // explicit comment update + a matching change on update-server.
  'runtime.output_origin_clicked': ['language', 'surface'],
  // RL-102 Slice 1 fold D — `repoState` ∈ `GIT_LAYER_REPO_STATES`.
  // No repo path, no branch name, no commit id.
  'git.layer_attached': ['repoState'],
  // RL-102 Slice 1 fold D — pure counter, no per-event properties.
  // The redactor drops any key that arrives anyway.
  'git.diff_panel_opened': [],
  // RL-102 Slice 2 — `repoState` ∈ `GIT_LAYER_REPO_STATES`,
  // `branchChanged` boolean. No branch / commit text on the wire.
  'git.head_changed': ['repoState', 'branchChanged'],
  // RL-102 Slice 2 — `target` ∈ `REVEAL_IN_SC_TARGETS`. Closed enum
  // stays single-valued (`'repo-root'`) today; future targets must
  // touch both renderer + update-server validators (parity test
  // catches drift).
  'git.reveal_in_source_control_clicked': ['target'],
  // RL-102 Slice 2 fold E — `mode` ∈ `EXTERNAL_RELOAD_MODES`.
  'git.external_modification_reload': ['mode'],
  // RL-103 Slice 1 fold B — `templateId` ∈ `TEMPLATE_PROJECT_IDS`
  // (closed enum, mirrored on update-server). `language` is the
  // language-pack id validated by `isSafeToken`.
  'template_project_applied': ['templateId', 'language'],
  // RL-024 Slice 2 — `scope` ∈ REPLACE_IN_FILES_SCOPES,
  // `countBucket` ∈ DEPENDENCY_COUNT_BUCKETS_SET, `regex` boolean.
  'editor.replace_in_files_applied': ['scope', 'countBucket', 'regex'],
};

// RL-094 Slice 1 — extracted to `src/shared/redaction.ts` so the same
// rules apply verbatim to Run Capsules. The re-export preserves the
// historical public surface (callers that imported `DENY_SUBSTRINGS`
// from telemetry continue to work).
import {
  DENY_SUBSTRINGS,
  keyLooksSensitive,
  valueLooksSensitive,
} from './redaction';

export { DENY_SUBSTRINGS };

const SAFE_TOKEN_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
// RL-020 Slice 7 — widened from `['ok', 'error']` to include the
// two distinct termination kinds the renderer now distinguishes:
// `'timeout'` (the worker hit the preset deadline) and `'stopped'`
// (the user clicked Stop). Dashboards that already accepted only
// `'ok'` / `'error'` keep working — the new values are rejected by
// the old validator, so an old worker silently drops them, and the
// parity test enforces the renderer + update-server stay in sync.
const RUNNER_STATUS_VALUES = new Set([
  'ok',
  'error',
  'timeout',
  'stopped',
]);
// RL-020 Slice 7 — closed enum mirroring `RuntimeTimeoutPreset` in
// `src/shared/runtimeTimeoutPresets.ts`. Duplicated here so the
// redactor stays a pure module without an import cycle; a parity
// test asserts both sides stay in sync.
const RUNTIME_TIMEOUT_PRESET_VALUES = new Set([
  'quick',
  'normal',
  'long',
  'extended',
]);
// RL-019 Slice 2 — closed enum mirror of `NodeRunKind` exported
// from `src/main/node-runner.ts`. Duplicated here so the redactor
// stays a pure module without an import cycle; the parity test
// asserts both sides stay in sync.
const NODE_RUNNER_STATUS_VALUES = new Set([
  'success',
  'error',
  'timeout',
  'stopped',
  'missing-binary',
]);
// RL-020 Slice 9 — variable inspector adoption bucket enum. Source
// of truth in `src/shared/scopeSnapshot.ts` (`VARIABLE_COUNT_BUCKETS`);
// duplicated here so the redactor stays a pure module without an
// import cycle.
const VARIABLE_INSPECTOR_COUNT_BUCKETS = new Set([
  '0',
  '1-5',
  '6-20',
  '21-50',
  '51+',
]);
// RL-044 Slice 1B — closed enum mirroring `ConsolePayloadKindBucket`
// in `src/renderer/types/index.ts`. Duplicated here so the redactor
// stays a pure module without an import cycle; a parity test asserts
// both sides stay in sync (the union of `ScopeValue` discriminants the
// renderer maps to `'object' | 'array' | 'text'` + the additional
// `RichOutputPayload` kinds reserved in `src/shared/richOutput.ts`).
export const CONSOLE_RICH_KIND_BUCKETS = new Set([
  'table',
  'object',
  'array',
  'mapSet',
  'date',
  'promise',
  'text',
  'rawText',
  'image',
  'chart',
  // RL-044 Slice 1C fold F — Python BaseException payloads ship the
  // error kind from __lingua_console_serialize. The renderer paints
  // them via the same chip + popover chain as other payloads, but
  // the redactor would silently drop the kind without an explicit
  // bucket. Added so the telemetry survives the closed-enum gate.
  'error',
  // RL-044 Slice 2a — sandboxed HTML payloads. The renderer paints
  // them via `<RichValueHtml>`; the bucket lets dashboards isolate
  // HTML rendering adoption from chart / image.
  'html',
]);
// RL-044 Slice 2a — closed enums backing
// `runtime.rich_media_payload_rejected`. Duplicated here for the
// same reason as `CONSOLE_RICH_KIND_BUCKETS`; the parity test in
// `update-server/test/telemetry.test.ts` keeps both sides in sync.
export const RICH_MEDIA_REJECTED_KINDS = new Set(['image', 'html', 'chart']);
export const RICH_MEDIA_REJECTED_REASONS = new Set([
  'invalid-src',
  'size-limit',
  'validation-failed',
]);
// RL-042 Slice 6 — closed enums for the Ruby dispatcher telemetry.
// Duplicated here for the same reason as CONSOLE_RICH_KIND_BUCKETS;
// the parity test in `update-server/tests/telemetry.parity.test.ts`
// keeps both sides in sync.
export const RUBY_DISPATCHED_MODE_VALUES = new Set([
  'system',
  'wasm',
  'missing',
]);
export const RUBY_SPAWN_BUCKETS = new Set([
  '<100ms',
  '<300ms',
  '<1s',
  '<3s',
  '>=3s',
]);
export const RUBY_RUNTIME_PREFERENCE_VALUES = new Set([
  'auto',
  'system',
  'wasm',
]);
// RL-024 Slice 1 — closed enum bucketing the navigator userAgent for
// `runtime.fs_directory_picker_unsupported`. Browsers that lack
// File System Access API today: Safari (`'safari'`), Firefox
// (`'firefox'`), older Edge (`'edge-old'`). Anything else falls to
// `'other'` so adoption stays bucketable even if a new browser
// joins the list. Mirrored on update-server with a parity test.
export const FS_DIRECTORY_PICKER_UA_BUCKETS = new Set([
  'safari',
  'firefox',
  'edge-old',
  'other',
]);
// RL-094 Slice 1 fold A — closed enums backing the
// `capsule.exported` event. Duplicated here (vs. importing from the
// renderer-side `RunCapsulesSection`) for the same reason as
// `CONSOLE_RICH_KIND_BUCKETS`: the redactor stays a pure module
// without renderer-side import cycles. Parity test in
// `update-server/test/telemetry.test.ts` keeps both copies aligned.
export const CAPSULE_EXPORT_TRIGGERS = new Set([
  'settings-export',
  'palette-export',
  // RL-094 Slice 1.5 — primary surface: icon button in the result
  // panel header. Tagged distinctly so the dashboard can measure
  // adoption of the in-context surface vs the audit (Settings) and
  // power-user (palette) entries.
  'result-panel-export',
]);
export const CAPSULE_SIZE_BUCKETS = new Set([
  '<10kb',
  '<100kb',
  '<1mb',
  '<4mb',
  '>=4mb',
]);
// RL-095 Slice 1 fold A — closed enum for the surface that drove a
// Language Support Scorecard view. Mirrored on update-server with
// parity test. The property name is `surface` (not `source`) because
// `source` is in `DENY_SUBSTRINGS` and would be stripped before the
// closed-enum validator could run.
export const LANGUAGE_SCORECARD_SURFACES = new Set([
  'settings',
  'palette',
]);
// RL-036 Phase A1 fold B — `trigger` ∈ surface that initiated the
// share-link copy. Mirrored on update-server.
export const SHARE_CREATE_TRIGGERS = new Set([
  'button',
  'palette',
  'shortcut',
]);
// RL-036 Phase A1 fold B — `status` ∈ outcome of the encode pass.
// `cancelled` currently covers user dismissal and clipboard-write
// failure. Mirrored on update-server.
export const SHARE_CREATE_STATUSES = new Set([
  'success',
  'too-large',
  'unknown-language',
  'cancelled',
]);
// RL-036 Phase A1 fold B — `status` ∈ outcome of the decode pass
// (`useShareLinkBoot` hook). Mirrored on update-server.
export const SHARE_OPEN_STATUSES = new Set([
  'success',
  'decode-fail',
  'unknown-language',
  'unknown-version',
  'oversized',
]);
// RL-036 Phase A1 fold G — bucketed fragment size. Mirrored on
// update-server. Lives here in `Set` form for `isAllowedValue`; the
// canonical list lives in `src/shared/sharePayload.ts` as
// `SHARE_SIZE_BUCKETS` (readonly tuple).
export const SHARE_SIZE_BUCKETS_SET = new Set([
  '<1kb',
  '<2kb',
  '<4kb',
  '<6kb',
  '>=6kb',
]);
// RL-101 Slice 1 — closed-enum stage label for the
// `onboarding.toast_dismissed` event. Mirrors the two interactive
// toast stages from the choreography (welcome seed has no toast).
export const ONBOARDING_TOAST_STAGES = new Set([
  'first_run',
  'first_snippet',
]);
// RL-101 fold B — closed-enum dismiss attribution. `cta` is a CTA
// button click, `manual` is the X dismiss, `auto` is the 6s timeout.
export const ONBOARDING_DISMISS_MODES = new Set([
  'cta',
  'manual',
  'auto',
]);
// RL-096 Slice 1 fold A — closed enum for the surface that opened
// the Privacy + Trust dashboard. `'settings'` is the rail click (the
// user navigated via Settings UI); `'palette'` is the command-palette
// entry. Once-per-mount tag so the metric reflects discovery routes.
export const PRIVACY_DASHBOARD_SURFACES = new Set([
  'settings',
  'palette',
]);
// RL-044 Sub-slice G — closed enum for the discovery surface of the
// `runtime.output_origin_clicked` event. Only badge clicks emit
// telemetry today; the symmetric hover direction is intentionally
// silent (hover would create burst noise indistinguishable from
// passive mouse movement). A future widening to `'hover'` requires
// an explicit allowlist comment update + a matching change on
// update-server (the parity test catches drift). Mirrored on
// update-server.
export const OUTPUT_ORIGIN_SURFACES = new Set(['badge']);
// RL-102 Slice 1 fold D — closed enum for the `repoState` property
// on `git.layer_attached`. `'git-repo'` means the opened folder
// resolved to a real `.git` root via `git rev-parse --show-toplevel`;
// `'no-git'` means git is installed but the folder is not a repo
// (single-file scratchpad with no parent .git); `'no-binary'` means
// the `git` binary itself wasn't found on PATH so the renderer
// suppressed the pill + panel entirely. Mirrored on update-server
// with parity test.
export const GIT_LAYER_REPO_STATES = new Set([
  'git-repo',
  'no-git',
  'no-binary',
]);
// RL-102 Slice 2 — closed enum for the `target` property on
// `git.reveal_in_source_control_clicked`. Single value today; the
// closed set lets future Slice 3+ extensions (e.g. `'commit-hash'`
// jumping to a specific commit in an external SC GUI) layer in
// without rewriting the validator.
export const REVEAL_IN_SC_TARGETS = new Set(['repo-root']);
// RL-102 Slice 2 fold E — closed enum for the `mode` property on
// `git.external_modification_reload`. Mirrored on update-server
// with parity test. The `'auto-applied'` slot is reserved for a
// future auto-reload-clean-tabs surface that today is intentionally
// out of scope ("no silent file mutation" per AGENTS.md).
export const EXTERNAL_RELOAD_MODES = new Set([
  'user-accepted',
  'user-rejected',
  'auto-applied',
]);
// RL-103 Slice 1 fold B — closed enum for the `templateId` property
// on `template_project_applied`. Source of truth lives in the
// renderer-side catalog at `src/renderer/data/projectTemplates/index.ts`;
// duplicated here because `src/shared/` must not import from
// `src/renderer/`. The parity test in
// `update-server/test/telemetry.test.ts` enforces byte-for-byte
// equality across both copies + the server mirror.
export const TEMPLATE_PROJECT_IDS = new Set([
  'express-api-hello',
  'fastapi-hello',
  'node-cli-argparse',
  'react-component-sandbox',
  'python-data-explorer',
]);
// RL-025 Slice A — closed bucket enum mirroring
// `DEPENDENCY_COUNT_BUCKETS` from `src/shared/dependencies/types.ts`.
// Duplicated here for the same reason as `CONSOLE_RICH_KIND_BUCKETS`
// (this module stays pure with no renderer-side import cycles); the
// parity test in `update-server/test/telemetry.test.ts` keeps both
// copies aligned.
export const DEPENDENCY_COUNT_BUCKETS_SET = new Set([
  '0',
  '1',
  '2-5',
  '6-10',
  '>10',
]);
// RL-025 Slice B — closed enums backing the install lifecycle events.
// Canonical home is `src/shared/dependencies/types.ts`; duplicated here
// for the same reason as `CONSOLE_RICH_KIND_BUCKETS` (this redactor
// stays a pure module without renderer-side import cycles). The parity
// test in `update-server/test/telemetry.test.ts` keeps both copies
// aligned with the canonical const-tuple source of truth.
export const DEPENDENCY_INSTALL_OUTCOMES_SET = new Set([
  'success',
  'partial',
  'failed',
  'cancelled',
  'timed-out',
]);
// RL-025 Slice C — `unsupported-wheel` mirrors the canonical
// DEPENDENCY_INSTALL_FAILURE_REASONS in `src/shared/dependencies/types.ts`.
// Kept outside the literal so the regex parity test stays
// single-quote clean (apostrophes inside array literals break the
// extraction).
// RL-024 Slice 2 — closed enum for the `scope` property on
// `editor.replace_in_files_applied`. Source of truth on the renderer
// side; mirrored on update-server with parity test.
export const REPLACE_IN_FILES_SCOPES = new Set([
  'single-file',
  'all-files',
]);
export const DEPENDENCY_INSTALL_FAILURE_REASONS_SET = new Set([
  'invalid-specifier',
  'no-package-json',
  'binary-missing',
  'exit-nonzero',
  'timeout',
  'cancelled',
  'unsupported-wheel',
  'unknown',
]);
// RL-101 Slice 1 — language ids that the `language` property on
// `onboarding.first_run_completed` is validated against. Pulled
// from `LANGUAGE_PACKS` so a new pack does not require a manual
// edit here — the import below re-exports the existing source of
// truth so renderer and update-server stay in lock-step (the
// server mirror duplicates the set verbatim since it cannot import
// from `src/`).
import { LANGUAGE_PACKS as ONBOARDING_LANGUAGE_PACKS } from './languagePacks';
const ONBOARDING_LANGUAGE_IDS = new Set(
  ONBOARDING_LANGUAGE_PACKS.map((pack) => pack.id)
);
const DURATION_BUCKETS = new Set([0, 50, 250, 1000, 5000, 30_000, 60_000]);
const UPDATE_CHECKED_STATUS_VALUES = new Set([
  'available',
  'no-update',
  'failure',
]);
const HISTORY_CLEAR_SCOPES = new Set(['session', 'persisted', 'all']);
// RL-019 Slice 1 — closed enum mirroring `RuntimeMode`. The
// shared `runtimeModes.ts` module is the source of truth for the
// production code; this Set is duplicated here so the redactor
// stays a pure module without an import cycle. A parity test
// asserts both stay in sync.
const RUNTIME_MODE_VALUES = new Set(['worker', 'node', 'browser-preview']);
// RL-020 Slice 1 — closed enum for the auto-run gate reason. Today
// only the renderer's `useAutoRun` emits `'incomplete'`; the validator
// rejects anything else so a future heuristic-expansion has to amend
// this Set + its mirror in `update-server/src/telemetry.ts`.
const AUTO_RUN_GATE_REASONS = new Set(['incomplete']);
// RL-020 Slice 2 — closed enum mirroring `WorkflowMode` in
// `src/shared/workflowMode.ts`. Duplicated here so this redactor
// stays a pure module without an import cycle; a parity test
// asserts both stay in sync.
const WORKFLOW_MODE_VALUES = new Set(['run', 'debug', 'scratchpad']);
// RL-020 Slice 2 — closed enum for the `trigger` property on
// `runtime.workflow_mode_changed`. `toolbar` is an explicit user
// gesture; `language_change` is the auto-correction emitted by
// `renameTab` when the new language no longer supports the previous
// mode. A future slice that adds Settings-driven retroactive
// propagation would extend this Set + the mirror in
// `update-server/src/telemetry.ts` in the same commit (the parity
// test enforces both sides at CI time).
const WORKFLOW_MODE_CHANGE_TRIGGERS = new Set([
  'toolbar',
  'language_change',
]);
// RL-020 Slice 4 — closed enum for the `surface` property on
// `runtime.history_replay`. `tab_pill` is the per-tab RecentRunsPill
// shipped this slice; `palette` is the command-palette Replay
// action shipped in RL-028 Slice 6; `popover` is the
// ExecutionHistoryPopover Replay button. Mirrored on the worker.
const HISTORY_REPLAY_SURFACES = new Set([
  'tab_pill',
  'palette',
  'popover',
]);
// RL-020 Slice 5 fold A — closed enum for the `countBucket`
// property on `runtime.auto_log_emitted`. `bucketAutoLogCount` in
// `src/renderer/hooks/useAutoRun.ts` is the only producer; the
// renderer + worker validators reject every other value. Mirrored
// in `update-server/src/telemetry.ts`; a parity test enforces
// both copies stay aligned.
const AUTO_LOG_COUNT_BUCKETS = new Set([
  '1',
  '2-5',
  '6-20',
  '20-plus',
]);
const DEBUGGER_REASON_BUCKETS: Record<
  Extract<
    TelemetryEventName,
    'debugger.attached' | 'debugger.paused' | 'debugger.detached'
  >,
  ReadonlySet<string>
> = {
  'debugger.attached': new Set(['attach']),
  'debugger.paused': new Set(['user-breakpoint', 'step', 'exception']),
  'debugger.detached': new Set(['user-detach', 'run-complete', 'crash', 'stop']),
};

export function isSafeToken(value: unknown): value is string {
  return typeof value === 'string' && SAFE_TOKEN_RE.test(value);
}

function isSafeCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 1000
  );
}

function isAllowedValue(
  event: TelemetryEventName,
  key: string,
  value: unknown
): value is string | number | boolean {
  switch (event) {
    case 'app.launched':
      return isSafeToken(value);
    case 'runner.executed':
      if (key === 'language') return isSafeToken(value);
      if (key === 'status') return typeof value === 'string' && RUNNER_STATUS_VALUES.has(value);
      if (key === 'durationBucketMs') return typeof value === 'number' && DURATION_BUCKETS.has(value);
      return false;
    case 'overlay.opened':
      return key === 'overlayId' && isSafeToken(value);
    case 'feature.blocked':
      return (key === 'entitlement' || key === 'tier') && isSafeToken(value);
    case 'update.checked':
      return typeof value === 'string' && UPDATE_CHECKED_STATUS_VALUES.has(value);
    case 'utility.favorite.pinned':
      if (key === 'utilityId') return isSafeToken(value);
      if (key === 'count') return isSafeCount(value);
      return false;
    case 'utility.history.cleared':
      if (key === 'utilityId') return isSafeToken(value);
      if (key === 'scope') return typeof value === 'string' && HISTORY_CLEAR_SCOPES.has(value);
      return false;
    case 'utility.clipboard.applied':
      return key === 'utilityId' && isSafeToken(value);
    case 'debugger.attached':
    case 'debugger.paused':
    case 'debugger.detached':
      if (key === 'language') return isSafeToken(value);
      return (
        key === 'reasonBucket' &&
        typeof value === 'string' &&
        DEBUGGER_REASON_BUCKETS[event].has(value)
      );
    case 'runtime.mode_changed':
      if (key === 'mode') return typeof value === 'string' && RUNTIME_MODE_VALUES.has(value);
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'runtime.auto_run_gated':
      if (key === 'language') return isSafeToken(value);
      if (key === 'reason')
        return typeof value === 'string' && AUTO_RUN_GATE_REASONS.has(value);
      return false;
    case 'runtime.compare_view_toggled':
      if (key === 'language') return isSafeToken(value);
      if (key === 'enabled') return typeof value === 'boolean';
      return false;
    case 'runtime.workflow_mode_changed':
      if (key === 'language') return isSafeToken(value);
      if (key === 'from' || key === 'to')
        return typeof value === 'string' && WORKFLOW_MODE_VALUES.has(value);
      if (key === 'trigger')
        return (
          typeof value === 'string' && WORKFLOW_MODE_CHANGE_TRIGGERS.has(value)
        );
      return false;
    case 'runtime.magic_comment_emitted':
      if (key === 'language') return isSafeToken(value);
      if (key === 'hasArrow' || key === 'hasWatch')
        return typeof value === 'boolean';
      return false;
    case 'runtime.history_replay':
      if (key === 'language') return isSafeToken(value);
      if (key === 'status')
        return typeof value === 'string' && RUNNER_STATUS_VALUES.has(value);
      if (key === 'surface')
        return typeof value === 'string' && HISTORY_REPLAY_SURFACES.has(value);
      return false;
    case 'runtime.auto_log_enabled':
      if (key === 'language') return isSafeToken(value);
      if (key === 'enabled') return typeof value === 'boolean';
      return false;
    case 'runtime.auto_log_emitted':
      if (key === 'language') return isSafeToken(value);
      if (key === 'countBucket')
        return typeof value === 'string' && AUTO_LOG_COUNT_BUCKETS.has(value);
      return false;
    case 'runtime.stdin_used':
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'runtime.timeout_preset_changed':
      if (key === 'language') return isSafeToken(value);
      if (key === 'preset')
        return (
          typeof value === 'string' &&
          RUNTIME_TIMEOUT_PRESET_VALUES.has(value)
        );
      return false;
    case 'runtime.node_runner_used':
      if (key === 'language') return isSafeToken(value);
      if (key === 'status')
        return (
          typeof value === 'string' &&
          NODE_RUNNER_STATUS_VALUES.has(value)
        );
      return false;
    case 'runtime.variable_inspector_opened':
      if (key === 'language') return isSafeToken(value);
      if (key === 'variableCount')
        return (
          typeof value === 'string' &&
          VARIABLE_INSPECTOR_COUNT_BUCKETS.has(value)
        );
      return false;
    case 'runtime.variable_inspector_surface_changed':
      if (key === 'surface') return value === 'floating' || value === 'bottom';
      return false;
    case 'runtime.console_rich_rendered':
      if (key === 'kind')
        return (
          typeof value === 'string' && CONSOLE_RICH_KIND_BUCKETS.has(value)
        );
      return false;
    case 'runtime.console_table_called':
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'runtime.cursor_pulse_emitted':
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'runtime.python_console_payload_emitted':
      if (key === 'kind')
        return (
          typeof value === 'string' && CONSOLE_RICH_KIND_BUCKETS.has(value)
        );
      return false;
    case 'runtime.error_stack_frame_clicked':
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'runtime.rich_media_payload_rejected':
      if (key === 'kind')
        return (
          typeof value === 'string' && RICH_MEDIA_REJECTED_KINDS.has(value)
        );
      if (key === 'reason')
        return (
          typeof value === 'string' &&
          RICH_MEDIA_REJECTED_REASONS.has(value)
        );
      return false;
    case 'runtime.python_rich_media_used':
      if (key === 'kind')
        return (
          typeof value === 'string' && RICH_MEDIA_REJECTED_KINDS.has(value)
        );
      return false;
    case 'runtime.ruby_runner_dispatched':
      if (key === 'mode')
        return (
          typeof value === 'string' &&
          RUBY_DISPATCHED_MODE_VALUES.has(value)
        );
      if (key === 'bucketedSpawnMs')
        return (
          typeof value === 'string' &&
          RUBY_SPAWN_BUCKETS.has(value)
        );
      return false;
    case 'runtime.ruby_runtime_preference_changed':
      if (key === 'preference')
        return (
          typeof value === 'string' &&
          RUBY_RUNTIME_PREFERENCE_VALUES.has(value)
        );
      return false;
    case 'runtime.fs_directory_picker_unsupported':
      if (key === 'userAgentBucket')
        return (
          typeof value === 'string' &&
          FS_DIRECTORY_PICKER_UA_BUCKETS.has(value)
        );
      return false;
    case 'capsule.exported':
      if (key === 'trigger')
        return (
          typeof value === 'string' && CAPSULE_EXPORT_TRIGGERS.has(value)
        );
      if (key === 'sizeBucket')
        return typeof value === 'string' && CAPSULE_SIZE_BUCKETS.has(value);
      return false;
    case 'language_scorecard_viewed':
      if (key === 'surface')
        return (
          typeof value === 'string' && LANGUAGE_SCORECARD_SURFACES.has(value)
        );
      return false;
    case 'share.created':
      if (key === 'trigger')
        return typeof value === 'string' && SHARE_CREATE_TRIGGERS.has(value);
      if (key === 'status')
        return typeof value === 'string' && SHARE_CREATE_STATUSES.has(value);
      if (key === 'sizeBucket')
        return typeof value === 'string' && SHARE_SIZE_BUCKETS_SET.has(value);
      return false;
    case 'share.opened':
      if (key === 'status')
        return typeof value === 'string' && SHARE_OPEN_STATUSES.has(value);
      if (key === 'sizeBucket')
        return typeof value === 'string' && SHARE_SIZE_BUCKETS_SET.has(value);
      return false;
    case 'onboarding.first_run_completed':
      if (key === 'language')
        return (
          typeof value === 'string' &&
          (ONBOARDING_LANGUAGE_IDS as ReadonlySet<string>).has(value)
        );
      return false;
    case 'onboarding.first_snippet_saved':
      // Event carries no whitelisted properties; redactor drops
      // anything that arrives anyway.
      return false;
    case 'onboarding.toast_dismissed':
      if (key === 'stage')
        return typeof value === 'string' && ONBOARDING_TOAST_STAGES.has(value);
      if (key === 'dismissMode')
        return typeof value === 'string' && ONBOARDING_DISMISS_MODES.has(value);
      return false;
    case 'onboarding.toast_clobbered':
      if (key === 'outstandingStage')
        return typeof value === 'string' && ONBOARDING_TOAST_STAGES.has(value);
      return false;
    case 'privacy.dashboard_opened':
      if (key === 'surface')
        return (
          typeof value === 'string' && PRIVACY_DASHBOARD_SURFACES.has(value)
        );
      return false;
    case 'dependency.detected_in_tab':
      if (key === 'language') return isSafeToken(value);
      if (key === 'countBucket')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value)
        );
      return false;
    case 'dependency.banner_shown':
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'dependency.classifications_summary':
      if (key === 'language') return isSafeToken(value);
      if (
        key === 'detectedBucket' ||
        key === 'installedBucket' ||
        key === 'needsDesktopBucket' ||
        key === 'unsupportedBucket'
      ) {
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value)
        );
      }
      return false;
    case 'dependency.install_started':
      if (key === 'language') return isSafeToken(value);
      if (key === 'countBucket')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value)
        );
      return false;
    case 'dependency.install_completed':
      if (key === 'language') return isSafeToken(value);
      if (key === 'outcome')
        return (
          typeof value === 'string' &&
          DEPENDENCY_INSTALL_OUTCOMES_SET.has(value)
        );
      return false;
    case 'dependency.install_failed_reason':
      if (key === 'language') return isSafeToken(value);
      if (key === 'reason')
        return (
          typeof value === 'string' &&
          DEPENDENCY_INSTALL_FAILURE_REASONS_SET.has(value)
        );
      return false;
    case 'runtime.output_origin_clicked':
      if (key === 'language') return isSafeToken(value);
      if (key === 'surface')
        return typeof value === 'string' && OUTPUT_ORIGIN_SURFACES.has(value);
      return false;
    case 'git.layer_attached':
      if (key === 'repoState')
        return typeof value === 'string' && GIT_LAYER_REPO_STATES.has(value);
      return false;
    case 'git.diff_panel_opened':
      // Pure counter — no whitelisted properties. Any key that
      // arrives is dropped by the closed-enum validator falling
      // through to false.
      return false;
    case 'git.head_changed':
      if (key === 'repoState')
        return typeof value === 'string' && GIT_LAYER_REPO_STATES.has(value);
      if (key === 'branchChanged') return typeof value === 'boolean';
      return false;
    case 'git.reveal_in_source_control_clicked':
      if (key === 'target')
        return typeof value === 'string' && REVEAL_IN_SC_TARGETS.has(value);
      return false;
    case 'git.external_modification_reload':
      if (key === 'mode')
        return typeof value === 'string' && EXTERNAL_RELOAD_MODES.has(value);
      return false;
    case 'template_project_applied':
      if (key === 'templateId')
        return typeof value === 'string' && TEMPLATE_PROJECT_IDS.has(value);
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'editor.replace_in_files_applied':
      if (key === 'scope')
        return (
          typeof value === 'string' && REPLACE_IN_FILES_SCOPES.has(value)
        );
      if (key === 'countBucket')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value)
        );
      if (key === 'regex') return typeof value === 'boolean';
      return false;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export interface RedactionResult {
  event: TelemetryEvent;
  droppedKeys: string[];
}

/**
 * Strip everything not in the per-event allowlist, then defensively drop
 * anything whose key or value shape looks like user data slipped through.
 * The returned event is safe to send — the caller must still honor the
 * consent flag before calling this.
 */
export function redactForTelemetry(event: TelemetryEvent): RedactionResult {
  const allowed = EVENT_PROPERTY_ALLOWLIST[event.event];
  const allowedSet = new Set(allowed);
  const droppedKeys: string[] = [];
  const properties: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(event.properties)) {
    if (!allowedSet.has(key)) {
      droppedKeys.push(key);
      continue;
    }
    if (keyLooksSensitive(key) || valueLooksSensitive(value)) {
      droppedKeys.push(key);
      continue;
    }
    if (!isAllowedValue(event.event, key, value)) {
      droppedKeys.push(key);
      continue;
    }
    properties[key] = value as string | number | boolean;
  }

  return {
    event: {
      ...event,
      properties,
      // Round to the minute so nothing fingerprintable sneaks through the
      // timestamp field (helpful for users on small populations).
      timestamp: Math.floor(event.timestamp / 60_000) * 60_000,
    },
    droppedKeys,
  };
}

/** Bucket an OS version string into a coarse "platform/major" form. */
export function bucketOs(platform: string, version: string): string {
  if (!platform) return 'unknown';
  const major = version.match(/^\d+/u)?.[0] ?? 'unknown';
  return `${platform}/${major}`;
}

/**
 * Generate a coarse, non-persistent session id (32 hex chars). Used as a
 * fingerprint-resistant grouping key for events inside a single launch.
 * Deliberately module-agnostic so renderer + tests + any future main
 * emitter call through the same helper.
 */
export function createSessionId(): string {
  const source =
    typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
      ? crypto
      : globalThis.crypto;
  if (!source || typeof source.getRandomValues !== 'function') {
    // Worst case (no Web Crypto): return a time-based fallback. Still
    // single-launch scoped — it never leaves memory and is only used to
    // group events, never to identify a user.
    return `t${Date.now().toString(16)}${Math.floor(Math.random() * 0xffffff).toString(16)}`.padEnd(32, '0');
  }
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Simple duration bucketer so we never transmit raw run times. */
export function bucketDurationMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  if (ms < 50) return 50;
  if (ms < 250) return 250;
  if (ms < 1000) return 1000;
  if (ms < 5000) return 5000;
  if (ms < 30_000) return 30_000;
  return 60_000;
}
