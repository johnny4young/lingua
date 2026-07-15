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
  // IT2-G1 — one event per renderer boot phase. Payload is closed to
  // `{ phase, durationBucket }`; exact timings/timestamps stay local.
  'app.boot_phase',
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
  // RL-044 next slice — image pasted into the ConsolePanel rendered
  // as a rich `image` console entry. Closed-enum payload
  // `{ status, sizeBucket }`: `status ∈ IMAGE_CLIPBOARD_PASTE_STATUSES`
  // (`'pasted'` / `'rejected-oversized'` / `'rejected-unreadable'`),
  // `sizeBucket ∈ CAPSULE_SIZE_BUCKETS` (reused). NO image bytes, NO
  // data URI, NO MIME on the wire — only the closed buckets.
  'runtime.image_clipboard_pasted',
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
  // to a follow-up — see the RL-093 Slice 3 Status Update).
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
  // RL-094 Slice 3 fold G — adoption signal for the Pro-gated capsule
  // browse overlay. Closed-enum `{ surface, tier }` where
  // `surface ∈ CAPSULE_BROWSE_SURFACES` (palette / shortcut / settings
  // / action-pill) and `tier` is the safe-token license tier (same
  // open-token treatment as `feature.blocked.tier`). Fires once per
  // overlay mount so the upsell funnel (Free opens browse → upsell) is
  // measurable. NO capsuleId, NO source content. Mirrored on
  // update-server with a parity test.
  'capsule.browse_opened',
  // RL-094 Slice 4 — capsule diff comparator adoption signal. Closed-enum
  // `{ sameLanguage }` boolean (true when the two compared capsules share
  // a language). NO capsuleIds, NO source content, NO environment leaks.
  // Sorts after `capsule.browse_opened`, before `capsule.exported`
  // alphabetically. Mirrored on update-server with a parity test.
  'capsule.compared',
  // RL-094 Slice 1 fold A — adoption signal for the Run Capsule
  // export surface. Closed-enum `{ trigger, sizeBucket }` where
  // `trigger ∈ CAPSULE_EXPORT_TRIGGERS` and `sizeBucket ∈
  // CAPSULE_SIZE_BUCKETS`. No source content, no capsuleId, no
  // environment leaks. Mirrored on update-server with a parity test.
  'capsule.exported',
  // RL-094 Slice 2 fold D — inverse adoption signal for the capsule
  // import surface. Closed-enum `{ surface, status, sizeBucket }`
  // where `surface ∈ CAPSULE_IMPORT_SOURCES` (paste / file-picker
  // / drag-drop), `status ∈ CAPSULE_IMPORT_STATUSES` (decoded /
  // open-confirmed / cancelled / rejected), `sizeBucket ∈
  // CAPSULE_SIZE_BUCKETS`. NO source content, NO file paths, NO
  // capsuleId. Fires on every overlay decode attempt + on the
  // confirm-open + on overlay close so adoption funnels are
  // measurable. Mirrored on update-server with parity test.
  //
  // Note: property is named `surface` (not `sourceSurface`) because
  // `source` is in `DENY_SUBSTRINGS` — same precedent as
  // `language_scorecard_viewed` from RL-095 Slice 1.
  'capsule.imported',
  // RL-095 Slice 1 fold A — adoption signal for the Language Support
  // Scorecard. Closed-enum `{ surface }` where surface distinguishes
  // the surface that drove discovery ('settings' = Settings tab
  // scroll-into-view, 'palette' = command palette "Show language
  // support"). Once-per-session per surface guard. Mirrored on
  // update-server with parity test. The property key is `surface`
  // (not `source`) because the DENY_SUBSTRINGS pass below strips any
  // key whose lowercased name contains 'source' — same precedent as
  // `runtime.workflow_mode_changed { trigger }`.
  // RL-095 Slice 2 — scorecard Web/Desktop toggle adoption signal.
  'language_scorecard_platform_toggled',
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
  // RL-024 Slice 3 — project zip bundle export / import / reject.
  // `project.bundle_exported { status, fileCountBucket }` (status ∈
  // PROJECT_BUNDLE_EXPORT_STATUSES); `project.bundle_imported
  // { status, fileCountBucket }` (status ∈ PROJECT_BUNDLE_IMPORT_STATUSES);
  // `project.bundle_rejected { reason }` (reason ∈ BUNDLE_REJECT_REASONS,
  // structural archive failures only). `fileCountBucket` reuses
  // DEPENDENCY_COUNT_BUCKETS_SET. NO file paths, NO names, NO bytes on
  // the wire — only closed buckets. Mirrored on update-server.
  'project.bundle_exported',
  'project.bundle_imported',
  'project.bundle_rejected',
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
  // RL-097 Slice 1 fold F — HTTP workspace request execution.
  // Fires once per Send / Cmd+Enter. Closed-enum
  // `{ method, statusBucket, redactedHeadersBucket }` where
  // `method` ∈ HTTP_METHODS, `statusBucket` ∈ HTTP_STATUS_BUCKETS
  // (`'2xx' / '3xx' / '4xx' / '5xx' / 'network-error' / 'timeout' / 'cors-error'`),
  // and `redactedHeadersBucket` ∈ DEPENDENCY_COUNT_BUCKETS_SET. NO URL,
  // NO body, NO header values reach the wire. Mirrored on update-server
  // with parity test.
  'http.request_executed',
  // RL-100 Slice 1 fold E — Importer registry commit. Fires when the
  // user clicks Confirm on the global Import overlay (Mod+Alt+I).
  // Closed-enum `{ importerId, status, sizeBucket }` where
  // `importerId` ∈ IMPORTER_IDS_SET (Slice 1: `'curl-http'` only,
  // open for `'ipynb-notebook'` Slice 2 + `'postman-collection'` /
  // `'bruno-collection'` Slice 3), `status` ∈ IMPORT_STATUSES_SET
  // (`'ok' / 'rejected' / 'cancelled'`), `sizeBucket` reuses
  // CAPSULE_SIZE_BUCKETS from RL-094. NO URL, NO header values, NO
  // body content reaches the wire — only the bucketed source size
  // and the qualitative outcome. Mirrored on update-server with
  // parity test.
  'import.applied',
  // RL-100 Slice 2 fold E — `.ipynb` warning band. Fires once per
  // successful Jupyter notebook import when at least one warning
  // code surfaced (raw cell dropped, rich output dropped, unknown
  // kernel language, execute_result stripped). Closed-enum
  // `{ warningKindCount, dominantKind }` where `warningKindCount`
  // reuses DEPENDENCY_COUNT_BUCKETS_SET and `dominantKind` ∈
  // NOTEBOOK_WARNING_KINDS_SET. NO cell content, NO output bytes,
  // NO kernel name reach the wire. Mirrored on update-server with
  // parity test.
  'import.notebook_warnings_surfaced',
  // RL-100 Slice 3.5 (Postman vars) fold B — collection-variable
  // resolution outcome. Fires once per successful Postman collection
  // import that referenced ANY `{{variable}}` (resolved OR unresolved).
  // Closed-enum `{ resolvedBucket, unresolvedBucket }` where both ∈
  // DEPENDENCY_COUNT_BUCKETS_SET (`'0' / '1' / '2-5' / '6-10' / '>10'`):
  // `resolvedBucket` buckets the distinct collection vars substituted,
  // `unresolvedBucket` the distinct static placeholders left literal.
  // NO variable names, NO values, NO URLs reach the wire — only the two
  // bucketed counts. Mirrored on update-server with parity test.
  'import.postman_variables_resolved',
  // RL-097 Slice 2 fold F — SQL workspace query execution. Fires
  // once per Run / Cmd+Enter against the DuckDB-WASM engine.
  // Closed-enum `{ status, rowCountBucket, durationBucket }` where
  // `status` ∈ SQL_QUERY_STATUSES_SET (`'success' / 'sql-error' /
  // 'timeout' / 'too-large' / 'engine-load-failed'`), `rowCountBucket`
  // reuses DEPENDENCY_COUNT_BUCKETS_SET (`'0' / '1' / '2-5' / '6-10' /
  // '>10'`), and `durationBucket` ∈ SQL_DURATION_BUCKETS_SET
  // (`'<10ms' / '<100ms' / '<1s' / '<5s' / '<30s' / '>=30s'`). NO query
  // text, NO schema names, NO column names, NO row values reach the
  // wire. Mirrored on update-server with parity test.
  'sql.query_executed',
  // IT2-F3 — explicit request to inspect aggregate column statistics. The
  // event deliberately carries no query, schema, column, or result data.
  'sql.profile_opened',
  // RL-097 Slice 3 (SQL OPFS) fold F — SQL workspace storage backing.
  // Fires once per session when the DuckDB engine first resolves its
  // backing. Closed-enum `{ mode, requested }` where both ∈
  // SQL_STORAGE_MODES_SET (`'opfs' / 'memory'`): `mode` is the resolved
  // backing, `requested` is what the user opted into. NO database
  // content, table names, or row values reach the wire. Mirrored on
  // update-server with parity test.
  'sql.storage_mode',
  // RL-097 (SQL import) fold B — file imported as a DuckDB table. Fires
  // once per successful import. Closed-enum `{ format, source }` where
  // `format` ∈ SQL_IMPORT_FORMATS_SET (`'csv' / 'json' / 'parquet'`) and
  // `source` ∈ SQL_IMPORT_SOURCES_SET (`'drop' / 'picker'`). NO file
  // name, NO column names, NO row values reach the wire. Mirrored on
  // update-server with parity test.
  'sql.table_imported',
  // RL-099 Slice 1 fold F — utility pipeline execution. Fires once
  // per Run against a stored utility pipeline. Closed-enum
  // `{ stepCount, status }` where `stepCount` reuses
  // DEPENDENCY_COUNT_BUCKETS_SET and `status` ∈ PIPELINE_RUN_STATUSES_SET
  // (`'all-ok' / 'partial' / 'all-failed' / 'incompatible'`). NO step
  // contents, NO utility ids, NO input/output values reach the wire.
  // Mirrored on update-server with parity test.
  'utility.pipeline_executed',
  // RL-099 Slice 5 fold A — pipeline template gallery adoption. Fires
  // once when the user instantiates a starter from the gallery.
  // Closed-enum `{ templateId }` where templateId ∈
  // PIPELINE_TEMPLATE_IDS_SET (a curated, content-free catalog id). NO
  // pipeline contents on the wire. Mirrored on update-server with
  // parity test.
  'utility.pipeline_template_used',
  // RL-039 Slice B fold B — Recipes overlay discovery + Run + Test
  // commit. `recipe.opened { language }` fires when the user
  // confirms "Open" on the Recipes overlay (Mod+Alt+L). NO recipe id
  // on the wire — per-recipe granularity stays off Slice B (privacy
  // posture); Slice C+ can add behind a closed `RECIPE_IDS_SET`
  // parity test. `recipe.test_run { language, status }` fires once
  // per Run + Test settle. `status` ∈ RECIPE_RUN_STATUSES_SET from
  // `src/shared/lessonRunner.ts` (`'all-passed' / 'some-failed' /
  // 'all-failed' / 'execution-error' / 'sentinel-missing'`).
  // Mirrored on update-server with parity test cross-importing the
  // renderer source of truth.
  'recipe.opened',
  'recipe.test_run',
  // RL-043 Slice A fold B — notebook cell execution. Fires once per
  // `Run cell` settle (and once per cell in `Run all` / `Run above`).
  // Closed-enum `{ language, status }` where `language` ∈
  // `NOTEBOOK_CELL_LANGUAGES_SET` (Slice C executes JavaScript +
  // TypeScript; Python remains schema-only until its runner lands)
  // and `status` ∈ `NOTEBOOK_CELL_STATUSES_SET` (`'ok' / 'error' /
  // 'stopped'`). NO
  // cell source, NO output bytes reach the wire. Mirrored on
  // update-server with a 3-way parity test cross-importing the
  // canonical `NOTEBOOK_CELL_STATUSES` tuple from
  // `src/renderer/runtime/notebookSession.ts`.
  // RL-043 Slice (Monaco cells) fold E — a notebook cell's Monaco editor
  // was mounted (the user entered edit mode on a cell). Closed-enum
  // `{ language }` where `language` ∈ `NOTEBOOK_CELL_LANGUAGES_SET`. Lets us
  // later measure whether Monaco-backed cells slow large-notebook editing
  // before committing to virtualization/perf work. NO cell source on the
  // wire. Sorts before `cell_executed` (`cell_e-ditor` < `cell_e-xecuted`).
  'notebook.cell_editor_mounted',
  'notebook.cell_executed',
  // RL-043 Slice C fold E — a notebook cell's language was switched via
  // the per-cell selector. Closed-enum `{ to }` where `to` ∈
  // `NOTEBOOK_CELL_LANGUAGES_SET`; an adoption signal for TypeScript
  // cells. NO cell source reaches the wire. Mirrored on update-server.
  'notebook.cell_language_changed',
  // RL-043 Slice D fold D — a notebook was exported. Closed-enum
  // `{ format }` where `format` ∈ `NOTEBOOK_EXPORT_FORMATS_SET`
  // (`script` | `ipynb`). NO cell source / title on the wire. Mirrored
  // on update-server.
  'notebook.exported',
  // RL-126 / AUDIT-06 — a persisted Zustand store ran a schema migration on
  // rehydrate (its stored version was older than the current version). Closed
  // payload `{ store }` where `store` is the localStorage key (a safe token);
  // NO version numbers, NO persisted state reaches the wire. Lets us see which
  // stores actually hit a migration in the wild.
  'persistence.migrated',
  // RL-137 / AUDIT-17 — a renderer-initiated reopen/pick was refused by the
  // filesystem denylist. Closed payload `{ family }` ∈ FS_BLOCKED_FAMILIES
  // (mirrors BLOCKED_PATH_FAMILIES in src/main/ipc/permissions.ts). NO path,
  // NO filename reaches the wire — only the coarse family token. Mirrored on
  // update-server with a parity test.
  'fs.blocked',
  // RL-111 — workspace session restore. `session.restored` fires when a prior
  // session is rehydrated; closed payload `{ tabCount, source }` where
  // `source ∈ {auto, prompt}` (auto = `always` mode silent restore, prompt =
  // the user clicked the `ask`-mode toast). `session.snapshotDiscarded` fires
  // when the `ask` prompt is dismissed without restoring (`{ tabCount }`). NO
  // tab names, paths, languages, or content reach the wire — only the count.
  // Mirrored on update-server with a parity test.
  'session.restored',
  'session.snapshotDiscarded',
  // RL-108 — inline lint adoption. Fires at most once per session per
  // (language, severity, ruleId) when a JS/TS diagnostic first surfaces.
  // Closed payload `{ language, severity∈{error,warning,info},
  // ruleId∈{strict-equality, ts-native} }` — `ts-native` covers Monaco's
  // built-in TS worker diagnostics, the custom ids cover the `'lingua-lint'`
  // rules. NO code, message text, or positions reach the wire. Mirrored on
  // update-server with a parity test.
  'editor.lint_diagnostic_emitted',
  // RL-110 — smart paste detection. `editor.smart_paste_shown` fires when the
  // import toast appears; `editor.smart_paste_applied` fires when the user
  // resolves it. Closed payloads `{ handler∈SMART_PASTE_HANDLERS }` and
  // `{ handler, accepted }` (accepted=false on dismiss / keep-as-text). NO
  // pasted content, URLs, or paths reach the wire. Mirrored on update-server.
  'editor.smart_paste_shown',
  'editor.smart_paste_applied',
  // RL-112 — fires when the user toggles the persistent status bar; closed
  // payload `{ enabled }` boolean. Mirrored on update-server with a parity test.
  'editor.status_bar_toggled',
  // IT2-C1 — Run Ledger opt-in toggled; closed payload { enabled } boolean.
  // Fires from the Privacy settings toggle only. No run data, ever.
  'ledger.toggled',
  // IT2-C1 — the user cleared the whole ledger (schema drop). No payload.
  'ledger.cleared',
  // RL-109 close-out — project-scoped env adoption. Fires once per session the
  // first time a native runner resolves env for a project, with closed payload
  // `{ hasProjectVars }` (did the active project carry any project-tier vars).
  // NO keys, values, or project paths reach the wire. Mirrored on update-server.
  'env.project_scope_used',
] as const;
export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];

export const BOOT_PHASES = [
  'system-language',
  'i18n',
  'react-mount',
  'first-paint',
  'rehydration',
] as const;
export type BootPhase = (typeof BOOT_PHASES)[number];
const BOOT_PHASES_SET: ReadonlySet<string> = new Set(BOOT_PHASES);

export const BOOT_DURATION_BUCKETS = [
  '<50ms',
  '50-249ms',
  '250-999ms',
  '1-4.9s',
  '5-29.9s',
  '>=30s',
] as const;
export type BootDurationBucket = (typeof BOOT_DURATION_BUCKETS)[number];
const BOOT_DURATION_BUCKETS_SET: ReadonlySet<string> = new Set(BOOT_DURATION_BUCKETS);

export function bucketBootDuration(ms: number): BootDurationBucket {
  if (ms < 50) return '<50ms';
  if (ms < 250) return '50-249ms';
  if (ms < 1_000) return '250-999ms';
  if (ms < 5_000) return '1-4.9s';
  if (ms < 30_000) return '5-29.9s';
  return '>=30s';
}

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
  'app.boot_phase': ['phase', 'durationBucket'],
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
  // RL-044 next slice — `status` ∈ IMAGE_CLIPBOARD_PASTE_STATUSES,
  // `sizeBucket` ∈ CAPSULE_SIZE_BUCKETS. Mirrored on update-server;
  // the parity test asserts the status set stays aligned.
  'runtime.image_clipboard_pasted': ['status', 'sizeBucket'],
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
  // RL-094 Slice 3 fold G — `surface` ∈ `CAPSULE_BROWSE_SURFACES`,
  // `tier` is an open safe-token (license tier; mirrors
  // `feature.blocked.tier`).
  'capsule.browse_opened': ['surface', 'tier'],
  // RL-094 Slice 4 — `sameLanguage` is a boolean; the validator below
  // enforces the type.
  'capsule.compared': ['sameLanguage'],
  // RL-094 Slice 1 fold A — `trigger` ∈ `CAPSULE_EXPORT_TRIGGERS`,
  // `sizeBucket` ∈ `CAPSULE_SIZE_BUCKETS`. Both closed enums.
  'capsule.exported': ['trigger', 'sizeBucket'],
  // RL-094 Slice 2 fold D — `surface` ∈ `CAPSULE_IMPORT_SOURCES`,
  // `status` ∈ `CAPSULE_IMPORT_STATUSES`, `sizeBucket` ∈
  // `CAPSULE_SIZE_BUCKETS`. All three closed enums.
  'capsule.imported': ['surface', 'status', 'sizeBucket'],
  // RL-095 Slice 2 — `platform` ∈ `LANGUAGE_SCORECARD_PLATFORMS`.
  'language_scorecard_platform_toggled': ['platform'],
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
  // RL-024 Slice 3 — `status` ∈ PROJECT_BUNDLE_EXPORT_STATUSES /
  // PROJECT_BUNDLE_IMPORT_STATUSES, `reason` ∈ BUNDLE_REJECT_REASONS,
  // `fileCountBucket` ∈ DEPENDENCY_COUNT_BUCKETS_SET.
  'project.bundle_exported': ['status', 'fileCountBucket'],
  'project.bundle_imported': ['status', 'fileCountBucket'],
  'project.bundle_rejected': ['reason'],
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
  // RL-097 Slice 1 fold F + Slice 3a fold D — `method` ∈ HTTP_METHODS_SET,
  // `statusBucket` ∈ HTTP_STATUS_BUCKETS_SET, `redactedHeadersBucket`
  // ∈ DEPENDENCY_COUNT_BUCKETS_SET, `resolvedVarsBucket` ∈
  // DEPENDENCY_COUNT_BUCKETS_SET (count of distinct env `{{vars}}`
  // successfully resolved in the sent request). No URL, body, header
  // values, or variable names/values — only the bucketed count.
  'http.request_executed': [
    'method',
    'statusBucket',
    'redactedHeadersBucket',
    'resolvedVarsBucket',
  ],
  // RL-100 Slice 1 fold E — `importerId` ∈ IMPORTER_IDS_SET,
  // `status` ∈ IMPORT_STATUSES_SET, `sizeBucket` ∈
  // CAPSULE_SIZE_BUCKETS (reused from RL-094). No URL, no header
  // values, no body content on the wire.
  'import.applied': ['importerId', 'status', 'sizeBucket'],
  // RL-100 Slice 2 fold E — `warningKindCount` ∈
  // DEPENDENCY_COUNT_BUCKETS_SET, `dominantKind` ∈
  // NOTEBOOK_WARNING_KINDS_SET. No cell text, no output bytes, no
  // kernel name on the wire.
  'import.notebook_warnings_surfaced': ['warningKindCount', 'dominantKind'],
  // RL-100 Slice 3.5 (Postman vars) fold B — `resolvedBucket` +
  // `unresolvedBucket` ∈ DEPENDENCY_COUNT_BUCKETS_SET. No variable
  // names, values, or URLs on the wire.
  'import.postman_variables_resolved': ['resolvedBucket', 'unresolvedBucket'],
  // RL-097 Slice 2 fold F — `status` ∈ SQL_QUERY_STATUSES_SET,
  // `rowCountBucket` ∈ DEPENDENCY_COUNT_BUCKETS_SET, `durationBucket`
  // ∈ SQL_DURATION_BUCKETS_SET. No query text, schema names, or row
  // values on the wire.
  'sql.query_executed': ['status', 'rowCountBucket', 'durationBucket'],
  // IT2-F3 — pure interaction counter; profile data never leaves the device.
  'sql.profile_opened': [],
  // RL-097 Slice 3 (SQL OPFS) fold F — `mode` + `requested` ∈
  // SQL_STORAGE_MODES_SET. No database content on the wire.
  'sql.storage_mode': ['mode', 'requested'],
  // RL-097 (SQL import) fold B — `format` ∈ SQL_IMPORT_FORMATS_SET,
  // `source` ∈ SQL_IMPORT_SOURCES_SET. No file name, column names, or
  // row values on the wire.
  'sql.table_imported': ['format', 'source'],
  // RL-099 Slice 1 fold F — `stepCount` ∈ DEPENDENCY_COUNT_BUCKETS_SET,
  // `status` ∈ PIPELINE_RUN_STATUSES_SET. No step contents, utility
  // ids, or input/output values on the wire.
  'utility.pipeline_executed': ['stepCount', 'status'],
  // RL-099 Slice 5 fold A — `templateId` ∈ PIPELINE_TEMPLATE_IDS_SET.
  // No pipeline contents on the wire.
  'utility.pipeline_template_used': ['templateId'],
  // RL-039 Slice B fold B — `language` ∈ LANGUAGE_PACK_IDS (Slice B
  // catalog covers JS / TS / Python). NO recipe id on the wire.
  'recipe.opened': ['language'],
  // RL-039 Slice B fold B — `language` ∈ LANGUAGE_PACK_IDS, `status`
  // ∈ RECIPE_RUN_STATUSES_SET.
  'recipe.test_run': ['language', 'status'],
  // RL-043 Slice A fold B — `language` ∈ NOTEBOOK_CELL_LANGUAGES_SET
  // (Slice C: JavaScript + TypeScript runnable; Python schema-only),
  // `status` ∈ NOTEBOOK_CELL_STATUSES_SET
  // (`'ok' / 'error' / 'stopped'`).
  // RL-043 Slice (Monaco cells) fold E — `language` ∈ NOTEBOOK_CELL_LANGUAGES_SET.
  'notebook.cell_editor_mounted': ['language'],
  'notebook.cell_executed': ['language', 'status'],
  // RL-043 Slice C fold E — `to` ∈ NOTEBOOK_CELL_LANGUAGES_SET.
  'notebook.cell_language_changed': ['to'],
  // RL-043 Slice D fold D — `format` ∈ NOTEBOOK_EXPORT_FORMATS_SET.
  'notebook.exported': ['format'],
  // RL-126 / AUDIT-06 — only the store key survives; see the value validator.
  'persistence.migrated': ['store'],
  // RL-137 / AUDIT-17 — `family` ∈ FS_BLOCKED_FAMILIES. No path on the wire.
  'fs.blocked': ['family'],
  // RL-111 — `tabCount` is a non-negative integer (count only). `source`
  // is the closed enum `auto` | `prompt`.
  'session.restored': ['tabCount', 'source'],
  'session.snapshotDiscarded': ['tabCount'],
  // RL-108 — `language` is a safe token; `severity` ∈ error/warning/info;
  // `ruleId` ∈ LINT_RULE_IDS (custom ids + `ts-native`).
  'editor.lint_diagnostic_emitted': ['language', 'severity', 'ruleId'],
  // RL-110 — `handler` ∈ SMART_PASTE_HANDLERS; `accepted` is a boolean.
  'editor.smart_paste_shown': ['handler'],
  'editor.smart_paste_applied': ['handler', 'accepted'],
  // RL-112 — `enabled` is a boolean (status-bar visibility).
  'editor.status_bar_toggled': ['enabled'],
  // IT2-C1 — `enabled` is a boolean (Run Ledger opt-in state).
  'ledger.toggled': ['enabled'],
  // IT2-C1 — schema-drop acknowledgement; carries nothing.
  'ledger.cleared': [],
  // RL-109 close-out — `hasProjectVars` is a boolean; no env keys/values.
  'env.project_scope_used': ['hasProjectVars'],
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
  // RL-094 Slice 3 — per-row export from the Pro-gated capsule browse
  // overlay. Distinct so the dashboard can attribute exports that
  // originate from browsing history vs the latest-run surfaces.
  'list-export',
  // RL-099 Slice 3 — explicit "Save run as capsule" from the utility
  // pipeline panel. Distinct so the dashboard can measure how often a
  // pipeline run is promoted into the capsule ring.
  'pipeline-run',
]);
// RL-094 Slice 3 fold G — closed enum of surfaces that can open the
// capsule browse overlay. Mirrored in `update-server/src/telemetry.ts`
// with a parity test. The order is the render/discovery order of the
// entry points (keyboard, palette, Settings button, floating pill).
export const CAPSULE_BROWSE_SURFACES = new Set([
  'palette',
  'shortcut',
  'settings',
  'action-pill',
]);
export const CAPSULE_SIZE_BUCKETS = new Set([
  '<10kb',
  '<100kb',
  '<1mb',
  '<4mb',
  '>=4mb',
]);
// RL-044 — closed enum backing the `runtime.image_clipboard_pasted`
// event. `'pasted'` = an image was read from the clipboard and appended
// as a rich console entry; `'resized'` = the image exceeded
// `MAX_PASTED_IMAGE_BYTES` (2 MiB) and was downscaled to fit before
// appending; `'rejected-oversized'` = it exceeded the cap AND the
// downscale could not get it under; `'rejected-unreadable'` = the File
// read failed or the resulting data URI failed `validateImageSrc`.
// Mirrored in `update-server/src/telemetry.ts` with a parity test.
export const IMAGE_CLIPBOARD_PASTE_STATUSES = new Set([
  'pasted',
  'resized',
  'rejected-oversized',
  'rejected-unreadable',
]);
// RL-094 Slice 2 fold D — closed enums backing the
// `capsule.imported` event. Mirrored in `update-server/src/telemetry.ts`
// with parity tests.
//
//   - `sourceSurface` distinguishes which affordance the user picked
//     to load the capsule. `paste` covers both the textarea AND the
//     clipboard auto-detect (fold C); they're indistinguishable
//     beyond a one-shot consent flow that lives in Settings.
//   - `status` walks the funnel: `decoded` (valid capsule rendered in
//     preview), `open-confirmed` (user clicked "Open as new tab"),
//     `cancelled` (user dismissed without confirming), `rejected`
//     (decode failed — see overlay UI for the qualitative reject
//     reason which is NOT sent here; only the closed status bucket).
//
// Reject reasons themselves stay client-side because they could leak
// information about the user's capsule contents (e.g. wrong-version
// hints at the version field). The dashboard only learns the
// qualitative funnel position.
export const CAPSULE_IMPORT_SOURCES = new Set([
  'paste',
  'file-picker',
  'drag-drop',
]);
export const CAPSULE_IMPORT_STATUSES = new Set([
  'decoded',
  'open-confirmed',
  'cancelled',
  'rejected',
]);
// RL-100 Slice 1 fold E — closed enum of importer ids. Source of
// truth lives in `src/shared/importers/types.ts` (`IMPORTER_IDS`);
// duplicated here so the telemetry validator stays import-cycle-free.
// Parity test in `update-server/test/telemetry.test.ts` cross-imports
// the renderer source of truth to keep the two copies in sync.
// RL-100 Slice 2 widens with `'ipynb-notebook'`; Slice 3 widens with
// `'postman-collection'` + `'bruno-collection'`; RL-043 Slice E widens
// with `'linguanb-notebook'`.
export const IMPORTER_IDS_SET = new Set([
  'curl-http',
  'ipynb-notebook',
  'postman-collection',
  'bruno-collection',
  'linguanb-notebook',
]);
// RL-100 Slice 1 fold E — closed enum of import outcomes.
export const IMPORT_STATUSES_SET = new Set(['ok', 'rejected', 'cancelled']);
// RL-100 Slice 2 fold E — closed enum of `.ipynb` warning kinds
// surfaced by the `import.notebook_warnings_surfaced` event when an
// ipynb import succeeds WITH warnings. Source of truth lives in
// `src/shared/importers/types.ts` (`NOTEBOOK_WARNING_KINDS`);
// duplicated here for the import-cycle-free validator. Parity test
// in `update-server/test/telemetry.test.ts`.
export const NOTEBOOK_WARNING_KINDS_SET = new Set([
  'raw-cell-dropped',
  'rich-output-dropped',
  'unknown-language',
  'execute-result-stripped',
]);
// RL-039 Slice B fold B — closed enum of recipe run statuses. Source
// of truth lives in `src/shared/lessonRunner.ts`
// (`RECIPE_RUN_STATUSES`). Duplicated here so the telemetry
// validator stays import-cycle-free. Parity test in
// `update-server/test/telemetry.test.ts` cross-imports the renderer
// source of truth.
export const RECIPE_RUN_STATUSES_SET = new Set([
  'all-passed',
  'some-failed',
  'all-failed',
  'execution-error',
  'sentinel-missing',
]);
// RL-043 Slice A fold B — closed enum of notebook cell run statuses.
// Source of truth lives in `src/renderer/runtime/notebookSession.ts`
// (`NOTEBOOK_CELL_STATUSES`). Duplicated here so the telemetry
// validator stays import-cycle-free. Parity test in
// `update-server/test/telemetry.test.ts` cross-imports the renderer
// source of truth.
export const NOTEBOOK_CELL_STATUSES_SET = new Set([
  'ok',
  'error',
  'stopped',
]);
// RL-043 Slice A fold B — closed enum of code-cell languages. Source
// of truth in `src/shared/notebook.ts` (`NOTEBOOK_CELL_LANGUAGES`).
// Slice C runs JavaScript + TypeScript; Python remains schema-only and
// runner-rejected. The telemetry validator accepts all three so future
// Python wiring doesn't have to revisit this Set.
export const NOTEBOOK_CELL_LANGUAGES_SET = new Set([
  'javascript',
  'typescript',
  'python',
]);
// RL-043 Slice D fold D — closed enum of notebook export formats. Mirror
// on update-server with a parity test. `script` is the language-aware
// `.js`/`.ts`/`.py`/`.txt` export; `ipynb` is the Jupyter nbformat v4
// export; `linguanb` (RL-043 Slice E) is the native lossless export.
export const NOTEBOOK_EXPORT_FORMATS_SET = new Set([
  'script',
  'ipynb',
  'linguanb',
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
// RL-095 Slice 2 — `platform` ∈ the scorecard's Web/Desktop filter. Mirror
// of `SCORECARD_PLATFORMS` in `src/shared/languageSupport.ts` (kept as a
// local Set so update-server can mirror it without importing the renderer
// scorecard module); the parity test asserts all three stay aligned.
export const LANGUAGE_SCORECARD_PLATFORMS = new Set([
  'all',
  'web',
  'desktop',
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
// RL-024 Slice 3 — closed enums backing the project zip bundle events.
// Export funnel: `cancelled` (save dialog dismissed), `empty` (no
// visible files), `exported` (zip written), `failed` (pack / write
// error). Import funnel: `cancelled` (folder picker dismissed),
// `imported` (extracted), `non-empty-dir` (target had files),
// `rejected` (structural archive failure — the qualitative reason rides
// the separate `project.bundle_rejected` event). Mirrored on
// update-server with a parity test.
export const PROJECT_BUNDLE_EXPORT_STATUSES = new Set([
  'cancelled',
  'empty',
  'exported',
  'failed',
]);
export const PROJECT_BUNDLE_IMPORT_STATUSES = new Set([
  'cancelled',
  'imported',
  'non-empty-dir',
  'rejected',
]);
// Mirror of `BUNDLE_REJECT_REASONS` in `src/shared/projectBundle.ts`,
// duplicated here (not imported) so this redactor stays a pure module
// free of the `fflate` import that `projectBundle` pulls in. The parity
// test in `update-server/test/telemetry.test.ts` cross-imports the
// canonical tuple to keep both copies aligned.
export const PROJECT_BUNDLE_REJECT_REASONS = new Set([
  'empty',
  'entry-too-large',
  'malformed-zip',
  'no-files',
  'path-traversal',
  'too-large',
  'too-many-files',
  'zip-bomb',
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
// RL-097 Slice 1 fold F — closed enum for the `method` property on
// `http.request_executed`. Mirrored on update-server with parity test.
// The renderer-side source of truth is `HTTP_METHODS` in
// `src/shared/httpWorkspace.ts` — this Set is duplicated here so the
// telemetry validator can live in shared code without importing the
// workspace module (which carries renderer-only deps in the future).
export const HTTP_METHODS_SET = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);
// RL-097 Slice 1 fold F — closed enum for `statusBucket` on
// `http.request_executed`. `'2xx' / '3xx' / '4xx' / '5xx'` cover
// fetch responses; `'network-error' / 'timeout' / 'cors-error'`
// cover the typed runtime failures the renderer surfaces with
// distinct copy. Mirrored on update-server with parity test.
export const HTTP_STATUS_BUCKETS_SET = new Set([
  '2xx',
  '3xx',
  '4xx',
  '5xx',
  'network-error',
  'timeout',
  'cors-error',
]);
// RL-097 Slice 2 fold F — closed enum for `status` on
// `sql.query_executed`. `'success'` for DuckDB-returned rows;
// `'sql-error'` for DuckDB-thrown user errors; `'timeout'` for
// soft-timeout via Promise.race; `'too-large'` for results that
// exceed MAX_RESULT_ROWS / MAX_RESULT_PREVIEW_BYTES; and
// `'engine-load-failed'` for the rare case where DuckDB-WASM
// itself can't boot (offline / CSP / blocked WASM). The renderer-
// side source of truth is `SQL_QUERY_STATUSES` in
// `src/shared/sqlWorkspace.ts` — this Set is duplicated here so the
// telemetry validator can live in shared code without importing
// the workspace module. Mirrored on update-server with parity test.
export const SQL_QUERY_STATUSES_SET = new Set([
  'success',
  'sql-error',
  'timeout',
  'too-large',
  'engine-load-failed',
]);
// RL-097 Slice 3 (SQL OPFS) fold F — closed enum for `mode` +
// `requested` on `sql.storage_mode`. The renderer-side source of truth
// is `SQL_STORAGE_MODES` in `src/shared/sqlWorkspace.ts`; duplicated
// here so the validator stays in shared code without importing the
// workspace module. Mirrored on update-server with parity test.
export const SQL_STORAGE_MODES_SET = new Set(['opfs', 'memory']);
// RL-097 Slice 2 fold F — closed enum for `durationBucket` on
// `sql.query_executed`. Coarse-grained classes so dashboards group
// by shape (fast / slow / very-slow) without leaking the exact
// timing. Mirrored on update-server with parity test.
export const SQL_DURATION_BUCKETS_SET = new Set([
  '<10ms',
  '<100ms',
  '<1s',
  '<5s',
  '<30s',
  '>=30s',
]);
// RL-097 (SQL import) fold B — closed enum for `format` on
// `sql.table_imported`. The renderer-side source of truth is
// `SUPPORTED_IMPORT_FORMATS` in `src/shared/sqlWorkspace.ts`; duplicated
// here so the validator stays in shared code without importing the
// workspace module. Mirrored on update-server with parity test.
export const SQL_IMPORT_FORMATS_SET = new Set(['csv', 'json', 'parquet']);
// RL-097 (SQL import) fold B — closed enum for `source` on
// `sql.table_imported`: `'drop'` (drag-drop) vs `'picker'` (the
// keyboard-accessible Import button → native file dialog). Mirrored on
// update-server with parity test.
export const SQL_IMPORT_SOURCES_SET = new Set(['drop', 'picker']);
// RL-099 Slice 1 fold F — closed enum for `status` on
// `utility.pipeline_executed`. Source of truth lives in
// `src/shared/utilityPipeline.ts` (`PIPELINE_RUN_STATUSES`);
// duplicated here so the telemetry validator can stay free of
// renderer-only imports. Parity test cross-imports the shared set.
export const PIPELINE_RUN_STATUSES_SET = new Set([
  'all-ok',
  'partial',
  'all-failed',
  'incompatible',
]);
// RL-099 Slice 5 fold A — closed enum for `templateId` on
// `utility.pipeline_template_used`. Source of truth is
// `PIPELINE_TEMPLATE_IDS` in `src/shared/utilityPipelineTemplates.ts`;
// duplicated here so the validator stays free of renderer-only imports.
// Mirrored on update-server with a 3-way parity test.
export const PIPELINE_TEMPLATE_IDS_SET = new Set([
  'decode-jwt',
  'hash-base64',
  'url-decode-json',
  'html-decode',
  'slugify',
  'base64-decode-json',
  'humanize-timestamp',
  'convert-color',
  // RL-099 Slice 7 — string-inspect template gallery starter.
  'inspect-hidden-chars',
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
const RUNTIME_MODE_VALUES = new Set([
  'worker',
  'node',
  'browser-preview',
  // F-4 — Deno / Bun desktop runtimes.
  'deno',
  'bun',
]);
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

// RL-137 / AUDIT-17 — closed enum of filesystem-denylist families. Duplicated
// here (vs importing from `src/main/ipc/permissions.ts`) so the redactor stays
// a pure, node-free shared module. `update-server/test/telemetry.test.ts` and a
// renderer-side parity test cross-import `BLOCKED_PATH_FAMILIES` to keep this
// copy and the worker mirror aligned with the main-process source of truth.
export const FS_BLOCKED_FAMILIES = new Set([
  'system',
  'credentials',
  'app-data',
  'browser-profile',
  'lingua-data',
]);

// RL-111 — closed enum for the `session.restored` source property.
// `auto` = `always`-mode silent restore; `prompt` = user clicked the
// `ask`-mode restore toast.
export const SESSION_RESTORE_SOURCES = new Set(['auto', 'prompt']);

// RL-108 — closed enums for `editor.lint_diagnostic_emitted`. `ruleId`
// covers the custom `'lingua-lint'` rules plus `ts-native` (Monaco's
// built-in TS worker diagnostics). `severity` is the marker severity bucket.
export const LINT_RULE_IDS = new Set(['strict-equality', 'ts-native']);
export const LINT_SEVERITIES = new Set(['error', 'warning', 'info']);

// RL-110 — closed enum for the `handler` property of the smart-paste events.
// One token per paste-intent kind (mirrors `PasteIntentKind` in
// src/renderer/clipboard/pasteHandlers.ts).
export const SMART_PASTE_HANDLERS = new Set([
  'share-link',
  'capsule',
  'curl',
  'stack-trace',
  'large-json',
]);

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
    case 'app.boot_phase':
      if (key === 'phase') return typeof value === 'string' && BOOT_PHASES_SET.has(value);
      if (key === 'durationBucket') {
        return typeof value === 'string' && BOOT_DURATION_BUCKETS_SET.has(value);
      }
      return false;
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
    case 'capsule.browse_opened':
      if (key === 'surface')
        return (
          typeof value === 'string' && CAPSULE_BROWSE_SURFACES.has(value)
        );
      // `tier` is an open safe-token (free / pro / pro_lifetime / team /
      // trial / education) — same treatment as `feature.blocked.tier`.
      if (key === 'tier') return isSafeToken(value);
      return false;
    case 'capsule.compared':
      return key === 'sameLanguage' && typeof value === 'boolean';
    case 'capsule.exported':
      if (key === 'trigger')
        return (
          typeof value === 'string' && CAPSULE_EXPORT_TRIGGERS.has(value)
        );
      if (key === 'sizeBucket')
        return typeof value === 'string' && CAPSULE_SIZE_BUCKETS.has(value);
      return false;
    case 'capsule.imported':
      if (key === 'surface')
        return (
          typeof value === 'string' && CAPSULE_IMPORT_SOURCES.has(value)
        );
      if (key === 'status')
        return (
          typeof value === 'string' && CAPSULE_IMPORT_STATUSES.has(value)
        );
      if (key === 'sizeBucket')
        return typeof value === 'string' && CAPSULE_SIZE_BUCKETS.has(value);
      return false;
    case 'runtime.image_clipboard_pasted':
      if (key === 'status')
        return (
          typeof value === 'string' &&
          IMAGE_CLIPBOARD_PASTE_STATUSES.has(value)
        );
      if (key === 'sizeBucket')
        return typeof value === 'string' && CAPSULE_SIZE_BUCKETS.has(value);
      return false;
    case 'language_scorecard_platform_toggled':
      if (key === 'platform')
        return (
          typeof value === 'string' && LANGUAGE_SCORECARD_PLATFORMS.has(value)
        );
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
    case 'project.bundle_exported':
      if (key === 'status')
        return typeof value === 'string' && PROJECT_BUNDLE_EXPORT_STATUSES.has(value);
      if (key === 'fileCountBucket')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value);
      return false;
    case 'project.bundle_imported':
      if (key === 'status')
        return typeof value === 'string' && PROJECT_BUNDLE_IMPORT_STATUSES.has(value);
      if (key === 'fileCountBucket')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value);
      return false;
    case 'project.bundle_rejected':
      return (
        key === 'reason' &&
        typeof value === 'string' &&
        PROJECT_BUNDLE_REJECT_REASONS.has(value)
      );
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
    case 'http.request_executed':
      if (key === 'method')
        return typeof value === 'string' && HTTP_METHODS_SET.has(value);
      if (key === 'statusBucket')
        return (
          typeof value === 'string' && HTTP_STATUS_BUCKETS_SET.has(value)
        );
      if (key === 'redactedHeadersBucket')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value)
        );
      // RL-097 Slice 3a fold D — bucketed count of resolved env vars.
      if (key === 'resolvedVarsBucket')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value)
        );
      return false;
    case 'import.applied':
      if (key === 'importerId')
        return typeof value === 'string' && IMPORTER_IDS_SET.has(value);
      if (key === 'status')
        return typeof value === 'string' && IMPORT_STATUSES_SET.has(value);
      if (key === 'sizeBucket')
        return typeof value === 'string' && CAPSULE_SIZE_BUCKETS.has(value);
      return false;
    case 'import.notebook_warnings_surfaced':
      if (key === 'warningKindCount')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value)
        );
      if (key === 'dominantKind')
        return (
          typeof value === 'string' && NOTEBOOK_WARNING_KINDS_SET.has(value)
        );
      return false;
    case 'import.postman_variables_resolved':
      if (key === 'resolvedBucket' || key === 'unresolvedBucket')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value)
        );
      return false;
    case 'recipe.opened':
      if (key === 'language') return typeof value === 'string' && isSafeToken(value);
      return false;
    case 'recipe.test_run':
      if (key === 'language') return typeof value === 'string' && isSafeToken(value);
      if (key === 'status')
        return typeof value === 'string' && RECIPE_RUN_STATUSES_SET.has(value);
      return false;
    case 'notebook.cell_editor_mounted':
      return (
        key === 'language' &&
        typeof value === 'string' &&
        NOTEBOOK_CELL_LANGUAGES_SET.has(value)
      );
    case 'notebook.cell_executed':
      if (key === 'language')
        return typeof value === 'string' && NOTEBOOK_CELL_LANGUAGES_SET.has(value);
      if (key === 'status')
        return typeof value === 'string' && NOTEBOOK_CELL_STATUSES_SET.has(value);
      return false;
    case 'notebook.cell_language_changed':
      return (
        key === 'to' &&
        typeof value === 'string' &&
        NOTEBOOK_CELL_LANGUAGES_SET.has(value)
      );
    case 'notebook.exported':
      return (
        key === 'format' &&
        typeof value === 'string' &&
        NOTEBOOK_EXPORT_FORMATS_SET.has(value)
      );
    case 'persistence.migrated':
      // RL-126 — `store` is a localStorage key (a safe token like
      // `lingua-settings`); the closed-enum membership is enforced at the call
      // site by the `PersistedStoreName` union, and the token shape is enough
      // here (no PII, no version numbers, no payload).
      return key === 'store' && isSafeToken(value);
    case 'sql.query_executed':
      if (key === 'status')
        return (
          typeof value === 'string' && SQL_QUERY_STATUSES_SET.has(value)
        );
      if (key === 'rowCountBucket')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value)
        );
      if (key === 'durationBucket')
        return (
          typeof value === 'string' && SQL_DURATION_BUCKETS_SET.has(value)
        );
      return false;
    case 'sql.profile_opened':
      return false;
    case 'sql.storage_mode':
      // Both keys share the same closed enum.
      return (
        (key === 'mode' || key === 'requested') &&
        typeof value === 'string' &&
        SQL_STORAGE_MODES_SET.has(value)
      );
    case 'sql.table_imported':
      if (key === 'format')
        return typeof value === 'string' && SQL_IMPORT_FORMATS_SET.has(value);
      if (key === 'source')
        return typeof value === 'string' && SQL_IMPORT_SOURCES_SET.has(value);
      return false;
    case 'utility.pipeline_executed':
      if (key === 'stepCount')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value)
        );
      if (key === 'status')
        return (
          typeof value === 'string' && PIPELINE_RUN_STATUSES_SET.has(value)
        );
      return false;
    case 'utility.pipeline_template_used':
      return (
        key === 'templateId' &&
        typeof value === 'string' &&
        PIPELINE_TEMPLATE_IDS_SET.has(value)
      );
    case 'fs.blocked':
      return (
        key === 'family' && typeof value === 'string' && FS_BLOCKED_FAMILIES.has(value)
      );
    case 'session.restored':
      if (key === 'tabCount') return isSafeCount(value);
      if (key === 'source')
        return typeof value === 'string' && SESSION_RESTORE_SOURCES.has(value);
      return false;
    case 'session.snapshotDiscarded':
      return key === 'tabCount' && isSafeCount(value);
    case 'editor.lint_diagnostic_emitted':
      if (key === 'language') return isSafeToken(value);
      if (key === 'severity') return typeof value === 'string' && LINT_SEVERITIES.has(value);
      if (key === 'ruleId') return typeof value === 'string' && LINT_RULE_IDS.has(value);
      return false;
    case 'editor.smart_paste_shown':
      return key === 'handler' && typeof value === 'string' && SMART_PASTE_HANDLERS.has(value);
    case 'editor.smart_paste_applied':
      if (key === 'handler') return typeof value === 'string' && SMART_PASTE_HANDLERS.has(value);
      if (key === 'accepted') return typeof value === 'boolean';
      return false;
    case 'editor.status_bar_toggled':
      return key === 'enabled' && typeof value === 'boolean';
    case 'ledger.toggled':
      return key === 'enabled' && typeof value === 'boolean';
    case 'ledger.cleared':
      return false;
    case 'env.project_scope_used':
      return key === 'hasProjectVars' && typeof value === 'boolean';
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
