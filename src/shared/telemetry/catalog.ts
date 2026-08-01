/**
 * Closed telemetry event catalog and per-event property schema.
 *
 * This is the renderer authority mirrored by update-server. Keep additions
 * explicit: every event requires an allowlist entry in this same module.
 */

export const TELEMETRY_EVENTS = [
  'app.launched',
  // internal — one event per renderer boot phase. Payload is closed to
  // `{ phase, durationBucket }`; exact timings/timestamps stay local.
  'app.boot_phase',
  // internal — runtime bootstrap outcome. Payload is closed to
  // `{ language, durationBucket }` / `{ language, reason }`; byte
  // counts and URLs never leave the device.
  'runtime.bootstrap_completed',
  'runtime.bootstrap_failed',
  'runner.executed',
  'overlay.opened',
  'feature.blocked',
  'update.checked',
  // implementation — Developer Utilities productivity layer adoption.
  // Counts only; no content, no input/output payloads, no tool ids
  // beyond a fixed enum bucket already on the catalog.
  'utility.favorite.pinned',
  'utility.history.cleared',
  'utility.clipboard.applied',
  // implementation — debugger session lifecycle. Payload is locked to
  // `{ language, reasonBucket }` per DEBUGGER_ADR §4. No source, no code,
  // no expression content, no breakpoint coordinates.
  'debugger.attached',
  'debugger.paused',
  'debugger.detached',
  // implementation — per-tab JS/TS runtime mode change. Closed enum
  // payload `{ mode, language }`; no source, no tab id, no content.
  // See `docs/RUNTIME_MODES_ADR.md` for the policy.
  'runtime.mode_changed',
  // implementation — auto-run completion gate fired. Closed enum
  // payload `{ language, reason }`; no source, no tab id, no content.
  // Today only `reason: 'incomplete'` ships; the validator is locked
  // to that single value so a future expansion of the gate must
  // amend this allowlist + the mirror in update-server.
  'runtime.auto_run_gated',
  // implementation — first Browser preview live refresh in a renderer
  // session. Closed payload `{ language, intervalMs }`; intervalMs accepts
  // only the two live settings (300 / 1000), never Off or a raw duration.
  'runtime.browser_preview_auto_refresh',
  // implementation — Compare-with-last-stable adoption signal.
  // Closed-enum payload `{ language, enabled }`; no source code,
  // no tab id, no diff content. Fires on user-driven toggles (the
  // header button, the palette action, the Mod+Shift+D shortcut).
  // The flag flips both ways so dashboards can see enable vs.
  // disable separately.
  'runtime.compare_view_toggled',
  // implementation — per-tab workflow mode change. Closed enum
  // payload `{ language, from, to, trigger }`; no source code, no
  // tab id, no content. `from` + `to` are the WorkflowMode enum;
  // `trigger` tags what caused the change (toolbar click vs. the
  // language-change auto-correction in renameTab). Property is
  // named `trigger` (not `source`) so the DENY_SUBSTRINGS pass
  // does not strip it on the way out.
  'runtime.workflow_mode_changed',
  // implementation — magic-comment results emitted. Closed enum
  // payload `{ language, hasArrow, hasWatch }`; no expression
  // content, no line numbers, no values. Fired at most once per
  // debounced auto-run when at least one magic result reached the
  // panel, so adoption of `//=>` vs `// @watch` is observable
  // without per-comment noise.
  'runtime.magic_comment_emitted',
  // implementation — execution-history replay dispatched. Closed
  // enum payload `{ language, status, surface }`; no source code,
  // no expression content, no timestamp. `surface` tags WHICH UI
  // surface drove the replay (`tab_pill`, `palette`, `popover`) so
  // adoption per affordance is observable. Fired once per replay
  // dispatch, gated by the same EXECUTION_HISTORY entitlement that
  // controls the replay surfaces.
  'runtime.history_replay',
  // implementation detail — image pasted into the ConsolePanel rendered
  // as a rich `image` console entry. Closed-enum payload
  // `{ status, sizeBucket }`: `status ∈ IMAGE_CLIPBOARD_PASTE_STATUSES`
  // (`'pasted'` / `'rejected-oversized'` / `'rejected-unreadable'`),
  // `sizeBucket ∈ CAPSULE_SIZE_BUCKETS` (reused). NO image bytes, NO
  // data URI, NO MIME on the wire — only the closed buckets.
  'runtime.image_clipboard_pasted',
  // implementation — bare-expression auto-log mode adoption.
  // `runtime.auto_log_enabled` fires when the user toggles the
  // per-language Settings default (`{ language, enabled }`). The
  // event ALSO fires from the per-tab override path so adoption is
  // observable regardless of which surface the user used to flip
  // the bit. `enabled` is a boolean.
  'runtime.auto_log_enabled',
  // implementation note — per-run auto-log emission signal. Fires
  // at most once per clean auto-run that produced ≥1 auto-log
  // result. `countBucket` is a closed enum (`1`, `2-5`, `6-20`,
  // `20-plus`) so the redactor never has to accept raw counts.
  'runtime.auto_log_emitted',
  // implementation — bare-stdin adoption signal. Fires once per
  // run whose worker consumed ≥1 line from the pre-set stdin
  // buffer. Closed-enum payload: `{ language }`; no buffer
  // content, no consumed count, no source. The countBucket lives
  // on the panel only, not on the wire.
  'runtime.stdin_used',
  // implementation — desktop Node child-spawn runner adoption.
  // Fires once per `node` mode execute() with the final status
  // bucket. Closed-enum payload `{ language, status }`; no source,
  // no exit code, no error message. `status` is the closed enum
  // `'success'` / `'error'` / `'timeout'` / `'stopped'` /
  // `'missing-binary'`.
  'runtime.node_runner_used',
  // implementation — per-language timeout-preset change. Fires
  // when the user sets a new preset via Settings → Editor or via
  // the command palette. Closed-enum payload `{ language, preset }`;
  // no source code, no tab id, no content. `preset` is the
  // `RuntimeTimeoutPreset` closed enum.
  'runtime.timeout_preset_changed',
  // implementation — variable inspector adoption signal. Fires
  // when the user opens the inspector via any surface (header
  // toggle, palette action, keyboard shortcut). Closed-enum
  // payload `{ language, variableCount }`; `variableCount` is a
  // bucket string from `VARIABLE_COUNT_BUCKETS` (`'0'` / `'1-5'`
  // / `'6-20'` / `'21-50'` / `'51+'`).
  'runtime.variable_inspector_opened',
  // implementation note — adoption signal for the floating ↔ bottom
  // surface choice. Closed-enum payload `{ surface }` where `surface`
  // is `'floating'` or `'bottom'`. Mirrored on update-server (deferred
  // to a follow-up — see the implementation Status Update).
  'runtime.variable_inspector_surface_changed',
  // implementation — rich console payload rendered. Fires at most once
  // per console entry first-render so adoption per payload kind is
  // observable. Closed-enum payload `{ kind }` from
  // `CONSOLE_RICH_KIND_BUCKETS`. No source code, no expression
  // content, no per-entry counts. Mirrored on update-server with a
  // parity test.
  'runtime.console_rich_rendered',
  // implementation note — `console.table()` shim adoption signal.
  // Separate from `runtime.console_rich_rendered` so a dashboard can
  // count discovery of the explicit shim (vs. auto-detection of
  // tabular arrays by `serializeRichValue`). Closed-enum payload
  // `{ language }` only.
  'runtime.console_table_called',
  // implementation Sub-slice G.1 implementation note — implementation note inverse direction adoption.
  // Fires when the editor cursor settles on a line that matches at
  // least one console row's `origin.line` and the `<ConsolePanel>`
  // pulse listener actually paints. Closed-enum `{ language }`
  // (`isSafeToken`) only — no line numbers, no file paths. Lets us
  // measure adoption of the inverse direction independently from the
  // `runtime.output_origin_clicked` badge metric: a low ratio
  // (cursor_pulse / output_origin) means users only click the chip
  // and don't notice the symmetric editor→console pulse.
  'runtime.cursor_pulse_emitted',
  // implementation note — Python (Pyodide) console payload adoption
  // signal. Separate from the renderer-side
  // `runtime.console_rich_rendered` so dashboards can isolate
  // Python-runner-produced payloads from the renderer's render
  // dispatch. Closed-enum `{ kind }` mirrors `CONSOLE_RICH_KIND_BUCKETS`.
  'runtime.python_console_payload_emitted',
  // implementation — implementation adoption signal. Fires once per
  // click on a clickable stack frame. Closed-enum `{ language }`
  // only; no file, no line, no column, no function name. Mirrored on
  // update-server.
  'runtime.error_stack_frame_clicked',
  // implementation — rich-media payload rejection signal. Useful for
  // security dashboards: counts how often workers (or user-emitted
  // payloads) get bounced by the renderer-side validators. Closed
  // enum `{ kind, reason }`: `kind` ∈ `{'image','html','chart'}`,
  // `reason` ∈ `{'invalid-src','size-limit','validation-failed'}`.
  // No source, no payload content. Mirrored on update-server.
  'runtime.rich_media_payload_rejected',
  // implementation-β-β-α implementation note — Python-side `__lingua.chart/image/html`
  // adoption signal. Separate from `runtime.python_console_payload_emitted`
  // (which fires for any payload kind including auto-promoted table /
  // object from the print override) so the security dashboard can
  // isolate explicit user-emitted rich media. Closed-enum `{ kind }`
  // matches `RICH_MEDIA_REJECTED_KINDS`. Mirrored on update-server
  // with a parity test.
  'runtime.python_rich_media_used',
  // implementation — Ruby runtime dispatch signal. Fires on every
  // `RubyRunner.execute()` so dashboards can isolate the WASM-only
  // path from the system-binary path. Closed-enum payload
  // `{ mode, bucketedSpawnMs }` — `mode` is `'system'` / `'wasm'` /
  // `'missing'` (system requested but not detected), `bucketedSpawnMs`
  // is `'<100ms'` / `'<300ms'` / `'<1s'` / `'<3s'` / `'>=3s'`. No
  // source code, no file path, no IPC payload content. Mirrored on
  // update-server with a parity test.
  'runtime.ruby_runner_dispatched',
  // implementation — adoption signal for the Settings → Editor
  // "Ruby runtime" select. Closed-enum payload `{ preference }`
  // matching the persisted `rubyRuntimePreference` enum.
  'runtime.ruby_runtime_preference_changed',
  // implementation — fires once per session (debounced) when the web
  // build calls `selectDirectory()` but `window.showDirectoryPicker`
  // is unavailable (Safari, older Firefox). Closed-enum payload
  // `{ userAgentBucket }`. Lets us count how many users hit the
  // "Open folder" wall on browsers without File System Access API
  // before we promote a richer fallback. Mirrored on update-server.
  'runtime.fs_directory_picker_unsupported',
  // implementation note — adoption signal for the Pro-gated capsule
  // browse overlay. Closed-enum `{ surface, tier }` where
  // `surface ∈ CAPSULE_BROWSE_SURFACES` (palette / shortcut / settings
  // / action-pill) and `tier` is the safe-token license tier (same
  // open-token treatment as `feature.blocked.tier`). Fires once per
  // overlay mount so the upsell funnel (Free opens browse → upsell) is
  // measurable. NO capsuleId, NO source content. Mirrored on
  // update-server with a parity test.
  'capsule.browse_opened',
  // implementation — capsule diff comparator adoption signal. Closed-enum
  // `{ sameLanguage }` boolean (true when the two compared capsules share
  // a language). NO capsuleIds, NO source content, NO environment leaks.
  // Sorts after `capsule.browse_opened`, before `capsule.exported`
  // alphabetically. Mirrored on update-server with a parity test.
  'capsule.compared',
  // implementation note — adoption signal for the Run Capsule
  // export surface. Closed-enum `{ trigger, sizeBucket }` where
  // `trigger ∈ CAPSULE_EXPORT_TRIGGERS` and `sizeBucket ∈
  // CAPSULE_SIZE_BUCKETS`. No source content, no capsuleId, no
  // environment leaks. Mirrored on update-server with a parity test.
  'capsule.exported',
  // implementation note — inverse adoption signal for the capsule
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
  // `language_scorecard_viewed` from implementation
  'capsule.imported',
  // implementation note — adoption signal for the Language Support
  // Scorecard. Closed-enum `{ surface }` where surface distinguishes
  // the surface that drove discovery ('settings' = Settings tab
  // scroll-into-view, 'palette' = command palette "Show language
  // support"). Once-per-session per surface guard. Mirrored on
  // update-server with parity test. The property key is `surface`
  // (not `source`) because the DENY_SUBSTRINGS pass below strips any
  // key whose lowercased name contains 'source' — same precedent as
  // `runtime.workflow_mode_changed { trigger }`.
  // implementation — scorecard Web/Desktop toggle adoption signal.
  'language_scorecard_platform_toggled',
  'language_scorecard_viewed',
  // implementation Phase A1 implementation note — share-link creation. Closed-enum
  // `{ trigger, status, sizeBucket }` where trigger ∈ SHARE_CREATE_TRIGGERS
  // (button / palette / shortcut), status ∈ SHARE_CREATE_STATUSES
  // (success / too-large / unknown-language / cancelled), sizeBucket
  // ∈ SHARE_SIZE_BUCKETS. NO source content, NO encoded fragment, NO
  // URL — only the size bucket and the qualitative outcome. Mirrored
  // on update-server with parity test.
  'share.created',
  // implementation Phase A1 implementation note — share-link import (open from URL).
  // Closed-enum `{ status, sizeBucket }`. status discriminates the
  // import outcome (success / decode-fail / unknown-language /
  // unknown-version / oversized). sizeBucket is bucketed from the
  // raw fragment length BEFORE decode succeeds. Mirrored on
  // update-server with parity test.
  'share.opened',
  // implementation — onboarding choreography events. All three are
  // mirrored on update-server with parity test. Closed enums live
  // in `ONBOARDING_TOAST_STAGES` + `ONBOARDING_DISMISS_MODES`
  // (implementation note) below. `language` is validated against the existing
  // `LANGUAGE_PACK_IDS` set so the redactor's DENY_SUBSTRINGS pass
  // does not strip the value — `language` is not in the deny list.
  'onboarding.first_run_completed',
  'onboarding.first_snippet_saved',
  'onboarding.toast_dismissed',
  // implementation note — production diagnostic for the toast
  // clobber bug found in the implementation reviewer pass. Fires when an
  // incoming `'normal'`-priority notice push is refused because an
  // outstanding `'high'`-priority onboarding toast is still visible.
  // Closed-enum `{ outstandingStage }` so we can correlate clobber
  // attempts with the onboarding stage that survived. NO caller
  // identity, NO error text — only the qualitative outcome.
  'onboarding.toast_clobbered',
  // implementation note — adoption signal for the Privacy + Trust
  // dashboard. Closed-enum `{ surface }` where surface ∈
  // `PRIVACY_DASHBOARD_SURFACES` (`'settings'` for the rail click,
  // `'palette'` for the command-palette entry). Once-per-mount.
  // Mirrored on update-server with parity test.
  'privacy.dashboard_opened',
  // implementation — project zip bundle export / import / reject.
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
  // implementation — per-cycle adoption signal for the dependency
  // detection runner. Fires after each completed detect+classify
  // pass. Closed-enum `{ language, countBucket }` where countBucket
  // ∈ DEPENDENCY_COUNT_BUCKETS_SET (mirrors
  // `src/shared/dependencies/types.ts` DEPENDENCY_COUNT_BUCKETS).
  // NO package names, NO file paths, NO content. Mirrored on
  // update-server with parity test.
  'dependency.detected_in_tab',
  // implementation — once-per-(tab, language)-per-session signal
  // marking the first time the Dependencies panel surfaced a row
  // for that combination. Closed-enum `{ language }`. Lets us
  // measure how many fresh tabs ever surface a dependency vs how
  // many stay empty.
  'dependency.banner_shown',
  // implementation Slice A implementation note — once-per-(tab, language)-per-session
  // rollup of the classification result. Bucketed counts per status
  // so dashboards can see whether web users are constantly hitting
  // `needs-desktop`. Closed-enum buckets share the
  // DEPENDENCY_COUNT_BUCKETS set used by `detected_in_tab` so the
  // parity test only needs to validate one enum.
  'dependency.classifications_summary',
  // implementation — JS/TS desktop install batch fired. Closed-enum
  // `{ language, countBucket }` where countBucket reuses the existing
  // DEPENDENCY_COUNT_BUCKETS bucketer (1 / 2-5 / 6-10 / >10). Counts
  // are bucketed at the renderer before the validator sees them, so
  // the redactor never accepts raw integers. NO package names, NO
  // file paths, NO npm stderr. One event per click batch (implementation note
  // coalescing means one event covers N specifiers).
  'dependency.install_started',
  // implementation — install batch terminated. Closed-enum
  // `{ language, outcome }` from DEPENDENCY_INSTALL_OUTCOMES.
  // `partial` covers the mixed case where some installs succeeded
  // and others failed inside the same batch.
  'dependency.install_completed',
  // implementation — failure-reason rollup. Fires at most once per
  // failed / partial batch with the dominant DEPENDENCY_INSTALL_FAILURE_REASON.
  // Separate from `install_completed` so dashboards can split network
  // errors (`exit-nonzero`) from policy refusals (`no-package-json`,
  // `invalid-specifier`) without inferring from the outcome alone.
  // NO npm stderr text, NO exit code value — only the closed enum.
  'dependency.install_failed_reason',
  // implementation — output→source line affordance click. Fires
  // once when the user clicks an `<OutputLineBadge>` chip on a
  // console row. Closed-enum `{ language, surface }` where `surface` ∈
  // `OUTPUT_ORIGIN_SURFACES` (`'badge'` only today; the symmetric
  // hover direction does NOT emit a telemetry event because the
  // discovery surface is the badge click). implementation note throttles the
  // emit to 1 per 1000ms per `(language, surface)` bucket so a user
  // clicking 20 chips in a debugging burst produces ~2 events rather
  // than 20. No file, no line, no column — the line integer would
  // leak nothing per the redactor, but the closed allowlist keeps
  // the surface tight. Mirrored on update-server with parity test.
  'runtime.output_origin_clicked',
  // implementation note — Git read-only layer attachment signal.
  // Fires at most once per project root mount with the detected
  // posture. Closed-enum `{ repoState }` ∈ `GIT_LAYER_REPO_STATES`
  // (`'git-repo'` / `'no-git'` / `'no-binary'`). Useful so dashboards
  // can see what fraction of opened folders surface a usable git
  // posture; raw repo paths, branch names, and commit ids never
  // leave the device.
  'git.layer_attached',
  // implementation note — Git diff panel discovery signal. Fires
  // once when the user opens the bottom-panel Git diff tab (mount).
  // Pure counter — no payload, no file path, no diff content. Lets
  // us measure whether the diff panel is being used or whether the
  // pill alone carries the surface. Mirrored on update-server.
  'git.diff_panel_opened',
  // implementation — Branch / HEAD-change signal. Fires when the
  // main-side `.git/HEAD` watcher detects a settled change AND the
  // branch name actually differs from the previous cache (commit-
  // only updates are silent). Closed-enum
  // `{ repoState, branchChanged }` where `repoState` reuses
  // `GIT_LAYER_REPO_STATES` and `branchChanged` is a boolean. NO
  // branch names, NO commit hashes — the boolean keeps the signal
  // useful without leaking working-tree state. Mirrored on
  // update-server.
  'git.head_changed',
  // implementation — Reveal-in-Source-Control click. Fires when
  // the user clicks the right-click context-menu row that opens
  // the repo working tree in the OS file manager. Closed-enum
  // `{ target }` where `target ∈ REVEAL_IN_SC_TARGETS`. Today the
  // only valid target is `'repo-root'`; the closed enum stays
  // future-proof for implementation extensions. Mirrored on update-server
  // with parity test.
  'git.reveal_in_source_control_clicked',
  // implementation note — External-modification reload outcome.
  // Fires when the user clicks the Reload action on the
  // "File changed on disk" status notice (or rejects it). Closed-
  // enum `{ mode }` ∈ `EXTERNAL_RELOAD_MODES`
  // (`'user-accepted'` / `'user-rejected'` / `'auto-applied'`).
  // The `'auto-applied'` slot is reserved for a future
  // auto-reload-clean-tabs surface; the renderer never emits it
  // today. NO file path, NO content delta. Mirrored on update-server.
  'git.external_modification_reload',
  // implementation note — Curated project template applied. Fires
  // once per successful multi-file scaffold (after the entry file
  // opens in a new tab). Closed-enum payload
  // `{ templateId, language }` where `templateId` ∈
  // `TEMPLATE_PROJECT_IDS` and `language` is the language-pack id.
  // No file paths, no destination directory, no content. Mirrored
  // on update-server with parity test.
  'template_project_applied',
  // implementation — Replace in files applied. Fires once per
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
  // implementation note — HTTP workspace request execution.
  // Fires once per Send / Cmd+Enter. Closed-enum
  // `{ method, statusBucket, redactedHeadersBucket }` where
  // `method` ∈ HTTP_METHODS, `statusBucket` ∈ HTTP_STATUS_BUCKETS
  // (`'2xx' / '3xx' / '4xx' / '5xx' / 'network-error' / 'timeout' / 'cors-error'`),
  // and `redactedHeadersBucket` ∈ DEPENDENCY_COUNT_BUCKETS_SET. NO URL,
  // NO body, NO header values reach the wire. Mirrored on update-server
  // with parity test.
  'http.request_executed',
  // implementation note — Importer registry commit. Fires when the
  // user clicks Confirm on the global Import overlay (Mod+Alt+I).
  // Closed-enum `{ importerId, status, sizeBucket }` where
  // `importerId` ∈ IMPORTER_IDS_SET (implementation: `'curl-http'` only,
  // open for `'ipynb-notebook'` implementation + `'postman-collection'` /
  // `'bruno-collection'` implementation), `status` ∈ IMPORT_STATUSES_SET
  // (`'ok' / 'rejected' / 'cancelled'`), `sizeBucket` reuses
  // CAPSULE_SIZE_BUCKETS from internal NO URL, NO header values, NO
  // body content reaches the wire — only the bucketed source size
  // and the qualitative outcome. Mirrored on update-server with
  // parity test.
  'import.applied',
  // implementation note — `.ipynb` warning band. Fires once per
  // successful Jupyter notebook import when at least one warning
  // code surfaced (raw cell dropped, rich output dropped, unknown
  // kernel language, execute_result stripped). Closed-enum
  // `{ warningKindCount, dominantKind }` where `warningKindCount`
  // reuses DEPENDENCY_COUNT_BUCKETS_SET and `dominantKind` ∈
  // NOTEBOOK_WARNING_KINDS_SET. NO cell content, NO output bytes,
  // NO kernel name reach the wire. Mirrored on update-server with
  // parity test.
  'import.notebook_warnings_surfaced',
  // implementation (Postman vars) implementation note — collection-variable
  // resolution outcome. Fires once per successful Postman collection
  // import that referenced ANY `{{variable}}` (resolved OR unresolved).
  // Closed-enum `{ resolvedBucket, unresolvedBucket }` where both ∈
  // DEPENDENCY_COUNT_BUCKETS_SET (`'0' / '1' / '2-5' / '6-10' / '>10'`):
  // `resolvedBucket` buckets the distinct collection vars substituted,
  // `unresolvedBucket` the distinct static placeholders left literal.
  // NO variable names, NO values, NO URLs reach the wire — only the two
  // bucketed counts. Mirrored on update-server with parity test.
  'import.postman_variables_resolved',
  // implementation note — SQL workspace query execution. Fires
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
  // internal — explicit request to inspect aggregate column statistics. The
  // event deliberately carries no query, schema, column, or result data.
  'sql.profile_opened',
  // implementation (SQL OPFS) implementation note — SQL workspace storage backing.
  // Fires once per session when the DuckDB engine first resolves its
  // backing. Closed-enum `{ mode, requested }` where both ∈
  // SQL_STORAGE_MODES_SET (`'opfs' / 'memory'`): `mode` is the resolved
  // backing, `requested` is what the user opted into. NO database
  // content, table names, or row values reach the wire. Mirrored on
  // update-server with parity test.
  'sql.storage_mode',
  // implementation (SQL import) implementation note — file imported as a DuckDB table. Fires
  // once per successful import. Closed-enum `{ format, source }` where
  // `format` ∈ SQL_IMPORT_FORMATS_SET (`'csv' / 'json' / 'parquet'`) and
  // `source` ∈ SQL_IMPORT_SOURCES_SET (`'drop' / 'picker'`). NO file
  // name, NO column names, NO row values reach the wire. Mirrored on
  // update-server with parity test.
  'sql.table_imported',
  // implementation note — utility pipeline execution. Fires once
  // per Run against a stored utility pipeline. Closed-enum
  // `{ stepCount, status }` where `stepCount` reuses
  // DEPENDENCY_COUNT_BUCKETS_SET and `status` ∈ PIPELINE_RUN_STATUSES_SET
  // (`'all-ok' / 'partial' / 'all-failed' / 'incompatible'`). NO step
  // contents, NO utility ids, NO input/output values reach the wire.
  // Mirrored on update-server with parity test.
  'utility.pipeline_executed',
  // implementation note — pipeline template gallery adoption. Fires
  // once when the user instantiates a starter from the gallery.
  // Closed-enum `{ templateId }` where templateId ∈
  // PIPELINE_TEMPLATE_IDS_SET (a curated, content-free catalog id). NO
  // pipeline contents on the wire. Mirrored on update-server with
  // parity test.
  'utility.pipeline_template_used',
  // implementation Slice B implementation note — Recipes overlay discovery + Run + Test
  // commit. `recipe.opened { language }` fires when the user
  // confirms "Open" on the Recipes overlay (Mod+Alt+L). NO recipe id
  // on the wire — per-recipe granularity stays off implementation (privacy
  // posture); future work can add behind a closed `RECIPE_IDS_SET`
  // parity test. `recipe.test_run { language, status }` fires once
  // per Run + Test settle. `status` ∈ RECIPE_RUN_STATUSES_SET from
  // `src/shared/lessonRunner.ts` (`'all-passed' / 'some-failed' /
  // 'all-failed' / 'execution-error' / 'sentinel-missing'`).
  // Mirrored on update-server with parity test cross-importing the
  // renderer source of truth.
  'recipe.opened',
  'recipe.test_run',
  // implementation Slice A implementation note — notebook cell execution. Fires once per
  // `Run cell` settle (and once per cell in `Run all` / `Run above`).
  // Closed-enum `{ language, status }` where `language` ∈
  // `NOTEBOOK_CELL_LANGUAGES_SET` (implementation executes JavaScript +
  // TypeScript; Python remains schema-only until its runner lands)
  // and `status` ∈ `NOTEBOOK_CELL_STATUSES_SET` (`'ok' / 'error' /
  // 'stopped'`). NO
  // cell source, NO output bytes reach the wire. Mirrored on
  // update-server with a 3-way parity test cross-importing the
  // canonical `NOTEBOOK_CELL_STATUSES` tuple from
  // `src/renderer/runtime/notebookSession.ts`.
  // implementation Slice (Monaco cells) implementation note — a notebook cell's Monaco editor
  // was mounted (the user entered edit mode on a cell). Closed-enum
  // `{ language }` where `language` ∈ `NOTEBOOK_CELL_LANGUAGES_SET`. Lets us
  // later measure whether Monaco-backed cells slow large-notebook editing
  // before committing to virtualization/perf work. NO cell source on the
  // wire. Sorts before `cell_executed` (`cell_e-ditor` < `cell_e-xecuted`).
  'notebook.cell_editor_mounted',
  'notebook.cell_executed',
  // implementation Slice C implementation note — a notebook cell's language was switched via
  // the per-cell selector. Closed-enum `{ to }` where `to` ∈
  // `NOTEBOOK_CELL_LANGUAGES_SET`; an adoption signal for TypeScript
  // cells. NO cell source reaches the wire. Mirrored on update-server.
  'notebook.cell_language_changed',
  // implementation Slice D implementation note — a notebook was exported. Closed-enum
  // `{ format }` where `format` ∈ `NOTEBOOK_EXPORT_FORMATS_SET`
  // (`script` | `ipynb`). NO cell source / title on the wire. Mirrored
  // on update-server.
  'notebook.exported',
  // implementation detail — a persisted Zustand store ran a schema migration on
  // rehydrate (its stored version was older than the current version). Closed
  // payload `{ store }` where `store` is the localStorage key (a safe token);
  // NO version numbers, NO persisted state reaches the wire. Lets us see which
  // stores actually hit a migration in the wild.
  'persistence.migrated',
  // implementation detail — a renderer-initiated reopen/pick was refused by the
  // filesystem denylist. Closed payload `{ family }` ∈ FS_BLOCKED_FAMILIES
  // (mirrors BLOCKED_PATH_FAMILIES in src/main/ipc/permissions.ts). NO path,
  // NO filename reaches the wire — only the coarse family token. Mirrored on
  // update-server with a parity test.
  'fs.blocked',
  // internal — workspace session restore. `session.restored` fires when a prior
  // session is rehydrated; closed payload `{ tabCount, source }` where
  // `source ∈ {auto, prompt}` (auto = `always` mode silent restore, prompt =
  // the user clicked the `ask`-mode toast). `session.snapshotDiscarded` fires
  // when the `ask` prompt is dismissed without restoring (`{ tabCount }`). NO
  // tab names, paths, languages, or content reach the wire — only the count.
  // Mirrored on update-server with a parity test.
  'session.restored',
  'session.snapshotDiscarded',
  // internal — inline lint adoption. Fires at most once per session per
  // (language, severity, ruleId) when a JS/TS diagnostic first surfaces.
  // Closed payload `{ language, severity∈{error,warning,info},
  // ruleId∈{strict-equality, ts-native} }` — `ts-native` covers Monaco's
  // built-in TS worker diagnostics, the custom ids cover the `'lingua-lint'`
  // rules. NO code, message text, or positions reach the wire. Mirrored on
  // update-server with a parity test.
  'editor.lint_diagnostic_emitted',
  // internal — smart paste detection. `editor.smart_paste_shown` fires when the
  // import toast appears; `editor.smart_paste_applied` fires when the user
  // resolves it. Closed payloads `{ handler∈SMART_PASTE_HANDLERS }` and
  // `{ handler, accepted }` (accepted=false on dismiss / keep-as-text). NO
  // pasted content, URLs, or paths reach the wire. Mirrored on update-server.
  'editor.smart_paste_shown',
  'editor.smart_paste_applied',
  // internal — fires when the user toggles the persistent status bar; closed
  // payload `{ enabled }` boolean. Mirrored on update-server with a parity test.
  'editor.status_bar_toggled',
  // internal — Run Ledger opt-in toggled; closed payload { enabled } boolean.
  // Fires from the Privacy settings toggle only. No run data, ever.
  'ledger.toggled',
  // internal — the user cleared the whole ledger (schema drop). No payload.
  'ledger.cleared',
  // internal close-out — project-scoped env adoption. Fires once per session the
  // first time a native runner resolves env for a project, with closed payload
  // `{ hasProjectVars }` (did the active project carry any project-tier vars).
  // NO keys, values, or project paths reach the wire. Mirrored on update-server.
  'env.project_scope_used',
] as const;
export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];
export const EVENT_PROPERTY_ALLOWLIST = {
  'app.launched': ['platform', 'build', 'locale'],
  'app.boot_phase': ['phase', 'durationBucket'],
  'runtime.bootstrap_completed': ['language', 'durationBucket'],
  'runtime.bootstrap_failed': ['language', 'reason'],
  'runner.executed': ['language', 'status', 'durationBucketMs'],
  'overlay.opened': ['overlayId'],
  'feature.blocked': ['entitlement', 'tier'],
  // implementation — `status` is a closed enum:
  //   `available`  → autoupdater reported an update is ready/downloading.
  //   `no-update`  → autoupdater reported the build is already current.
  //   `failure`    → autoupdater raised an error during the check.
  // No version strings, no release notes, no error messages — those
  // would be free-form text and risk leaking host detail. Fired by
  // `src/renderer/stores/updateStore.ts` on every transition out of
  // the `checking` state.
  'update.checked': ['status'],
  // implementation — `utilityId` is the catalog enum value (a fixed
  // string set, not user data). `count` is the post-action favorites
  // length so we can see adoption without tracking per-tool.
  'utility.favorite.pinned': ['utilityId', 'count'],
  'utility.history.cleared': ['utilityId', 'scope'],
  'utility.clipboard.applied': ['utilityId'],
  // implementation — `language` is the runtime adapter id (a closed
  // enum: `js` / `python` / `go` / `rust`). `reasonBucket` is a closed
  // set partitioned by event:
  //   `debugger.attached` → `attach` (the only valid value today; if a
  //     future work adds a reattach path it MUST update this comment
  //     and the runbook in `docs/DEBUGGER.md`).
  //   `debugger.paused`   → `user-breakpoint` / `step` / `exception`.
  //   `debugger.detached` → `user-detach` / `run-complete` / `crash` / `stop`.
  // No expression content, no breakpoint line, no source snippet.
  'debugger.attached': ['language', 'reasonBucket'],
  'debugger.paused': ['language', 'reasonBucket'],
  'debugger.detached': ['language', 'reasonBucket'],
  // implementation — `mode` is the closed `RuntimeMode` enum
  // (`worker` / `node` / `browser-preview`). `language` is the
  // language-pack id; today only `javascript` / `typescript` ever
  // fires this event but the value-validator stays generic so
  // future work can extend the runtime-mode surface to other
  // languages without an allowlist churn.
  'runtime.mode_changed': ['mode', 'language'],
  // implementation — `language` is the language-pack id (today only
  // `javascript` / `typescript`). `reason` is a closed enum locked
  // to `'incomplete'` for implementation.
  'runtime.auto_run_gated': ['language', 'reason'],
  'runtime.browser_preview_auto_refresh': ['language', 'intervalMs'],
  // implementation — `language` is the language-pack id
  // (`isSafeToken`); `enabled` is a boolean flipping with the
  // user's toggle direction. Mirrored on update-server.
  'runtime.compare_view_toggled': ['language', 'enabled'],
  // implementation — `language` is the language-pack id (any
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
  // implementation — `language` is the language-pack id (any
  // `isSafeToken` string). `hasArrow` and `hasWatch` are booleans
  // surfacing which magic-comment shapes fired this run. The
  // validator allows only true / false values; integers or strings
  // are dropped silently.
  'runtime.magic_comment_emitted': ['language', 'hasArrow', 'hasWatch'],
  // implementation — `language` is the language-pack id; `status`
  // is the closed `ExecutionStatus` enum (`ok` / `error`);
  // `surface` is the closed `HistoryReplaySurface` enum (see
  // `HISTORY_REPLAY_SURFACES` below).
  'runtime.history_replay': ['language', 'status', 'surface'],
  // implementation detail — `status` ∈ IMAGE_CLIPBOARD_PASTE_STATUSES,
  // `sizeBucket` ∈ CAPSULE_SIZE_BUCKETS. Mirrored on update-server;
  // the parity test asserts the status set stays aligned.
  'runtime.image_clipboard_pasted': ['status', 'sizeBucket'],
  // implementation — `language` is the language-pack id (JS / TS
  // for the implementation surfaces; the validator stays generic so a
  // future widening to Python does not require an allowlist
  // change). `enabled` is a boolean.
  'runtime.auto_log_enabled': ['language', 'enabled'],
  // implementation note — `countBucket` is the closed enum
  // (`1`, `2-5`, `6-20`, `20-plus`) emitted by `bucketAutoLogCount`
  // in `useAutoRun.ts`. The renderer / worker validators reject
  // anything else.
  'runtime.auto_log_emitted': ['language', 'countBucket'],
  // implementation — language-only payload. Bucketed counts would
  // give the consumed-line distribution but also risk fingerprinting
  // a small population by per-run shape; implementation stays at adoption
  // level only.
  'runtime.stdin_used': ['language'],
  // implementation — `language` is the language-pack id
  // (`'javascript'` / `'typescript'`); `status` is the closed enum
  // (`'ok'` / `'error'` / `'timeout'` / `'stopped'` /
  // `'missing-binary'`). Mirrored on update-server.
  'runtime.node_runner_used': ['language', 'status'],
  // implementation — `language` is the language-pack id (`isSafeToken`);
  // `preset` is the closed `RuntimeTimeoutPreset` enum
  // (`quick` / `normal` / `long` / `extended`). Mirrored on
  // update-server; the parity test asserts both sets stay aligned.
  'runtime.timeout_preset_changed': ['language', 'preset'],
  // implementation — `language` is the language-pack id (`isSafeToken`);
  // `variableCount` is a closed enum bucket
  // (`'0'` / `'1-5'` / `'6-20'` / `'21-50'` / `'51+'`).
  'runtime.variable_inspector_opened': ['language', 'variableCount'],
  // implementation note — `surface` is the closed `'floating' | 'bottom'`
  // enum.
  'runtime.variable_inspector_surface_changed': ['surface'],
  // implementation — `kind` is the closed `ConsolePayloadKindBucket`
  // enum (`table` / `object` / `array` / `mapSet` / `date` / `promise`
  // / `text` / `rawText` / `image` / `chart`). Mirrored on
  // update-server.
  'runtime.console_rich_rendered': ['kind'],
  // implementation note — `language` is the language-pack id.
  // Mirrored on update-server.
  'runtime.console_table_called': ['language'],
  // implementation Sub-slice G.1 implementation note — `language` is the language-pack id
  // (`isSafeToken`). No line / file / payload. Mirrored on
  // update-server.
  'runtime.cursor_pulse_emitted': ['language'],
  // implementation note — `kind` is the closed `ConsolePayloadKindBucket`
  // enum (same set as `runtime.console_rich_rendered`).
  'runtime.python_console_payload_emitted': ['kind'],
  // implementation — `language` is the language-pack id
  // (`isSafeToken`). No file, no line, no column.
  'runtime.error_stack_frame_clicked': ['language'],
  // implementation — `kind` ∈ `RICH_MEDIA_REJECTED_KINDS`,
  // `reason` ∈ `RICH_MEDIA_REJECTED_REASONS`. Both closed enums
  // mirrored on update-server with a parity test.
  'runtime.rich_media_payload_rejected': ['kind', 'reason'],
  // implementation-β-β-α implementation note — `kind` ∈ `RICH_MEDIA_REJECTED_KINDS`
  // (chart / image / html). Mirrors update-server with a parity test.
  'runtime.python_rich_media_used': ['kind'],
  // implementation — `mode` is the closed `RubyDispatchedMode`
  // (`system` / `wasm` / `missing`); `bucketedSpawnMs` is the closed
  // bucket enum (`<100ms` / `<300ms` / `<1s` / `<3s` / `>=3s`).
  // Mirrored on update-server with a parity test.
  'runtime.ruby_runner_dispatched': ['mode', 'bucketedSpawnMs'],
  // implementation — `preference` is the closed
  // `rubyRuntimePreference` enum (`auto` / `system` / `wasm`).
  // Mirrored on update-server.
  'runtime.ruby_runtime_preference_changed': ['preference'],
  // implementation — `userAgentBucket` ∈
  // `FS_DIRECTORY_PICKER_UA_BUCKETS`.
  'runtime.fs_directory_picker_unsupported': ['userAgentBucket'],
  // implementation note — `surface` ∈ `CAPSULE_BROWSE_SURFACES`,
  // `tier` is an open safe-token (license tier; mirrors
  // `feature.blocked.tier`).
  'capsule.browse_opened': ['surface', 'tier'],
  // implementation — `sameLanguage` is a boolean; the validator below
  // enforces the type.
  'capsule.compared': ['sameLanguage'],
  // implementation note — `trigger` ∈ `CAPSULE_EXPORT_TRIGGERS`,
  // `sizeBucket` ∈ `CAPSULE_SIZE_BUCKETS`. Both closed enums.
  'capsule.exported': ['trigger', 'sizeBucket'],
  // implementation note — `surface` ∈ `CAPSULE_IMPORT_SOURCES`,
  // `status` ∈ `CAPSULE_IMPORT_STATUSES`, `sizeBucket` ∈
  // `CAPSULE_SIZE_BUCKETS`. All three closed enums.
  'capsule.imported': ['surface', 'status', 'sizeBucket'],
  // implementation — `platform` ∈ `LANGUAGE_SCORECARD_PLATFORMS`.
  language_scorecard_platform_toggled: ['platform'],
  // implementation note — `surface` ∈ `LANGUAGE_SCORECARD_SURFACES`.
  language_scorecard_viewed: ['surface'],
  // implementation Phase A1 implementation note — `trigger` ∈ `SHARE_CREATE_TRIGGERS`,
  // `status` ∈ `SHARE_CREATE_STATUSES`, `sizeBucket` ∈
  // `SHARE_SIZE_BUCKETS_SET`.
  'share.created': ['trigger', 'status', 'sizeBucket'],
  // implementation Phase A1 implementation note — `status` ∈ `SHARE_OPEN_STATUSES`,
  // `sizeBucket` ∈ `SHARE_SIZE_BUCKETS_SET`.
  'share.opened': ['status', 'sizeBucket'],
  // implementation — `language` ∈ `LANGUAGE_PACK_IDS` (existing
  // shared set; passes the redactor's DENY_SUBSTRINGS pass because
  // `language` is not in the deny list).
  'onboarding.first_run_completed': ['language'],
  // No fields: a single counter event marking the first ever snippet
  // save. Pure adoption signal, no qualifier needed.
  'onboarding.first_snippet_saved': [],
  // implementation — `stage` ∈ `ONBOARDING_TOAST_STAGES`,
  // `dismissMode` ∈ `ONBOARDING_DISMISS_MODES`.
  'onboarding.toast_dismissed': ['stage', 'dismissMode'],
  // implementation note — `outstandingStage` ∈
  // `ONBOARDING_TOAST_STAGES`.
  'onboarding.toast_clobbered': ['outstandingStage'],
  // implementation note — `surface` ∈ `PRIVACY_DASHBOARD_SURFACES`.
  'privacy.dashboard_opened': ['surface'],
  // implementation — `status` ∈ PROJECT_BUNDLE_EXPORT_STATUSES /
  // PROJECT_BUNDLE_IMPORT_STATUSES, `reason` ∈ BUNDLE_REJECT_REASONS,
  // `fileCountBucket` ∈ DEPENDENCY_COUNT_BUCKETS_SET.
  'project.bundle_exported': ['status', 'fileCountBucket'],
  'project.bundle_imported': ['status', 'fileCountBucket'],
  'project.bundle_rejected': ['reason'],
  // implementation — `language` is the adapter id (any `isSafeToken`
  // string; the set widens with implementation). `countBucket` is a
  // closed-enum bucket from `DEPENDENCY_COUNT_BUCKETS_SET`.
  'dependency.detected_in_tab': ['language', 'countBucket'],
  // implementation — `language` only; once-per-session per
  // (tab, language) so adoption is visible without per-cycle noise.
  'dependency.banner_shown': ['language'],
  // implementation Slice A implementation note — bucketed rollup per (tab, language) per
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
  // implementation — install lifecycle events. `language` is the
  // adapter id (`isSafeToken`); `countBucket` reuses the existing
  // DEPENDENCY_COUNT_BUCKETS_SET. `outcome` ∈ DEPENDENCY_INSTALL_OUTCOMES;
  // `reason` ∈ DEPENDENCY_INSTALL_FAILURE_REASONS.
  'dependency.install_started': ['language', 'countBucket'],
  'dependency.install_completed': ['language', 'outcome'],
  'dependency.install_failed_reason': ['language', 'reason'],
  // implementation — `language` is the language-pack id
  // (`isSafeToken`); `surface` ∈ `OUTPUT_ORIGIN_SURFACES` (`'badge'`).
  // The hover path does NOT emit so this allowlist intentionally
  // omits a `'hover'` value today; widening would require an
  // explicit comment update + a matching change on update-server.
  'runtime.output_origin_clicked': ['language', 'surface'],
  // implementation note — `repoState` ∈ `GIT_LAYER_REPO_STATES`.
  // No repo path, no branch name, no commit id.
  'git.layer_attached': ['repoState'],
  // implementation note — pure counter, no per-event properties.
  // The redactor drops any key that arrives anyway.
  'git.diff_panel_opened': [],
  // implementation — `repoState` ∈ `GIT_LAYER_REPO_STATES`,
  // `branchChanged` boolean. No branch / commit text on the wire.
  'git.head_changed': ['repoState', 'branchChanged'],
  // implementation — `target` ∈ `REVEAL_IN_SC_TARGETS`. Closed enum
  // stays single-valued (`'repo-root'`) today; future targets must
  // touch both renderer + update-server validators (parity test
  // catches drift).
  'git.reveal_in_source_control_clicked': ['target'],
  // implementation note — `mode` ∈ `EXTERNAL_RELOAD_MODES`.
  'git.external_modification_reload': ['mode'],
  // implementation note — `templateId` ∈ `TEMPLATE_PROJECT_IDS`
  // (closed enum, mirrored on update-server). `language` is the
  // language-pack id validated by `isSafeToken`.
  template_project_applied: ['templateId', 'language'],
  // implementation — `scope` ∈ REPLACE_IN_FILES_SCOPES,
  // `countBucket` ∈ DEPENDENCY_COUNT_BUCKETS_SET, `regex` boolean.
  'editor.replace_in_files_applied': ['scope', 'countBucket', 'regex'],
  // implementation note — `method` ∈ HTTP_METHODS_SET,
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
  // implementation note — `importerId` ∈ IMPORTER_IDS_SET,
  // `status` ∈ IMPORT_STATUSES_SET, `sizeBucket` ∈
  // CAPSULE_SIZE_BUCKETS (reused from internal). No URL, no header
  // values, no body content on the wire.
  'import.applied': ['importerId', 'status', 'sizeBucket'],
  // implementation note — `warningKindCount` ∈
  // DEPENDENCY_COUNT_BUCKETS_SET, `dominantKind` ∈
  // NOTEBOOK_WARNING_KINDS_SET. No cell text, no output bytes, no
  // kernel name on the wire.
  'import.notebook_warnings_surfaced': ['warningKindCount', 'dominantKind'],
  // implementation (Postman vars) implementation note — `resolvedBucket` +
  // `unresolvedBucket` ∈ DEPENDENCY_COUNT_BUCKETS_SET. No variable
  // names, values, or URLs on the wire.
  'import.postman_variables_resolved': ['resolvedBucket', 'unresolvedBucket'],
  // implementation note — `status` ∈ SQL_QUERY_STATUSES_SET,
  // `rowCountBucket` ∈ DEPENDENCY_COUNT_BUCKETS_SET, `durationBucket`
  // ∈ SQL_DURATION_BUCKETS_SET. No query text, schema names, or row
  // values on the wire.
  'sql.query_executed': ['status', 'rowCountBucket', 'durationBucket'],
  // internal — pure interaction counter; profile data never leaves the device.
  'sql.profile_opened': [],
  // implementation (SQL OPFS) implementation note — `mode` + `requested` ∈
  // SQL_STORAGE_MODES_SET. No database content on the wire.
  'sql.storage_mode': ['mode', 'requested'],
  // implementation (SQL import) implementation note — `format` ∈ SQL_IMPORT_FORMATS_SET,
  // `source` ∈ SQL_IMPORT_SOURCES_SET. No file name, column names, or
  // row values on the wire.
  'sql.table_imported': ['format', 'source'],
  // implementation note — `stepCount` ∈ DEPENDENCY_COUNT_BUCKETS_SET,
  // `status` ∈ PIPELINE_RUN_STATUSES_SET. No step contents, utility
  // ids, or input/output values on the wire.
  'utility.pipeline_executed': ['stepCount', 'status'],
  // implementation note — `templateId` ∈ PIPELINE_TEMPLATE_IDS_SET.
  // No pipeline contents on the wire.
  'utility.pipeline_template_used': ['templateId'],
  // implementation Slice B implementation note — `language` ∈ LANGUAGE_PACK_IDS (Slice B
  // catalog covers JS / TS / Python). NO recipe id on the wire.
  'recipe.opened': ['language'],
  // implementation Slice B implementation note — `language` ∈ LANGUAGE_PACK_IDS, `status`
  // ∈ RECIPE_RUN_STATUSES_SET.
  'recipe.test_run': ['language', 'status'],
  // implementation Slice A implementation note — `language` ∈ NOTEBOOK_CELL_LANGUAGES_SET
  // (implementation: JavaScript + TypeScript runnable; Python schema-only),
  // `status` ∈ NOTEBOOK_CELL_STATUSES_SET
  // (`'ok' / 'error' / 'stopped'`).
  // implementation Slice (Monaco cells) implementation note — `language` ∈ NOTEBOOK_CELL_LANGUAGES_SET.
  'notebook.cell_editor_mounted': ['language'],
  'notebook.cell_executed': ['language', 'status'],
  // implementation Slice C implementation note — `to` ∈ NOTEBOOK_CELL_LANGUAGES_SET.
  'notebook.cell_language_changed': ['to'],
  // implementation Slice D implementation note — `format` ∈ NOTEBOOK_EXPORT_FORMATS_SET.
  'notebook.exported': ['format'],
  // implementation detail — only the store key survives; see the value validator.
  'persistence.migrated': ['store'],
  // implementation detail — `family` ∈ FS_BLOCKED_FAMILIES. No path on the wire.
  'fs.blocked': ['family'],
  // internal — `tabCount` is a non-negative integer (count only). `source`
  // is the closed enum `auto` | `prompt`.
  'session.restored': ['tabCount', 'source'],
  'session.snapshotDiscarded': ['tabCount'],
  // internal — `language` is a safe token; `severity` ∈ error/warning/info;
  // `ruleId` ∈ LINT_RULE_IDS (custom ids + `ts-native`).
  'editor.lint_diagnostic_emitted': ['language', 'severity', 'ruleId'],
  // internal — `handler` ∈ SMART_PASTE_HANDLERS; `accepted` is a boolean.
  'editor.smart_paste_shown': ['handler'],
  'editor.smart_paste_applied': ['handler', 'accepted'],
  // internal — `enabled` is a boolean (status-bar visibility).
  'editor.status_bar_toggled': ['enabled'],
  // internal — `enabled` is a boolean (Run Ledger opt-in state).
  'ledger.toggled': ['enabled'],
  // internal — schema-drop acknowledgement; carries nothing.
  'ledger.cleared': [],
  // internal close-out — `hasProjectVars` is a boolean; no env keys/values.
  'env.project_scope_used': ['hasProjectVars'],
} satisfies Record<TelemetryEventName, readonly string[]>;
