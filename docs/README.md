# Lingua — docs index

All long-form engineering documents live in this folder. Code-level docs
stay inside `src/`; user-facing product docs live on linguacode.dev and
are not part of this repo.

## Planning

Canonical status + priority for every `RL-XXX` ticket, deep per-ticket scope,
sprint sequencing, raw idea capture, and shipped-history archiving are tracked
in internal planning docs that are not part of this repo.

## Reading order (new contributors)

1. [`DEVELOPMENT.md`](./DEVELOPMENT.md) — contributor workflow (clone, dev/test/smoke/build commands, Pro testing locally, automation/delivery).
2. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — process model (main vs. renderer),
   IPC filesystem bridge, watch-state, project lifecycle.
3. [`CAPABILITY_MATRIX.md`](./CAPABILITY_MATRIX.md) — which execution class
   (browser WASM, browser interpreter, WebContainer, desktop native, hybrid)
   owns each capability today. Don't propose WASM-first migrations outside
   the promotion rules listed there.
4. [`USAGE.md`](./USAGE.md) — end-user product reference (keyboard shortcuts, deep links, plugin format, browser-only limitations, update behavior).
5. [`TEST_PLAN.md`](./TEST_PLAN.md) — test strategy, coverage targets,
   how unit / component / Playwright / desktop smoke tests divide labor.
6. [`A11Y.md`](./A11Y.md) — accessibility quality gate: automated
   axe-core scans, keyboard-only flow tests, focus restoration, plus
   a manual screen-reader checklist for VoiceOver / NVDA.
7. [`PERFORMANCE.md`](./PERFORMANCE.md) — bundle/runtime budgets,
   local report commands, CI performance logs, and desktop smoke
   runtime/memory metrics folded into `runtimeObservability`.
8. [`RECOVERY.md`](./RECOVERY.md) — error boundaries, safe-mode
    boot (`?safe-mode=1`), boot-loop counter / factory mode, the
    Recovery surface in Settings → Account, and the manual recovery
    folder paths per platform.
9. [`PUBLIC_READINESS_AUDIT.md`](./PUBLIC_READINESS_AUDIT.md) —
    current public-source readiness, release/security gaps, and the
    pre-publication action queue.
10. [`CLI_USAGE.md`](./CLI_USAGE.md) — RL-098 Slice 1 CLI surface
    (`lingua utility`, `lingua capsule validate`, `lingua list
    utilities`); install/uninstall, exit-code contract, CI tips.

## Architecture Decision Records (ADRs)

Each ADR captures one design call with context, alternatives, and the
decision. ADRs are **additive** — once filed they are not rewritten,
only superseded by a new ADR that names the one it replaces.

| ADR                                                | Scope                                                                                                                                                       | Owning RL task                                             |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [`BUILD_SYSTEM_ADR.md`](./BUILD_SYSTEM_ADR.md)     | Stay on Electron Forge vs. move to electron-vite / electron-builder                                                                                         | `RL-034`                                                   |
| [`DEBUGGER_ADR.md`](./DEBUGGER_ADR.md)             | Debugger MVP — which backend and UI surface                                                                                                                 | `RL-027`                                                   |
| [`ENV_VARS_ADR.md`](./ENV_VARS_ADR.md)             | Environment variables for execution contexts (global / project / tab tiers)                                                                                 | `RL-011`                                                   |
| [`LANGUAGE_PACK_ADR.md`](./LANGUAGE_PACK_ADR.md)   | Declarative language-pack registry                                                                                                                          | `RL-038`                                                   |
| [`RUNTIME_ASSETS_ADR.md`](./RUNTIME_ASSETS_ADR.md) | Vendoring + integrity-locking runtime assets; Pyodide same-origin posture; `VITE_LINGUA_WEB_RUNTIME_BASE` / R2-hosted oversized web WASM for DuckDB/Ruby; per-surface CSP rules | `RL-083`                                                   |
| [`RUNTIME_MODES_ADR.md`](./RUNTIME_MODES_ADR.md)   | Per-tab JS/TS runtime modes (Worker / desktop Node / Browser preview); Worker default, desktop Node subprocess contract, iframe preview sandbox             | `RL-019`                                                   |
| [`STATUS_NOTICE_PRIORITY_ADR.md`](./STATUS_NOTICE_PRIORITY_ADR.md) | Priority field on `StatusNotice` so onboarding / choreographed toasts cannot be clobbered by routine `'normal'` pushes; errors always win | `RL-101` Slice 1.5                                          |
| [`TAURI_SPIKE_ADR.md`](./TAURI_SPIKE_ADR.md)       | Tauri 2 feasibility spike                                                                                                                                   | `RL-035`                                                   |
| [`VIM_MODE_ADR.md`](./VIM_MODE_ADR.md)             | Vim mode integration inside the personalization slice                                                                                                       | `RL-037`                                                   |

## Where things live

| If you need…                                                                                                                             | Go to                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Contributor workflow (dev/test/smoke/build commands, Pro testing locally)                                                                | [`DEVELOPMENT.md`](./DEVELOPMENT.md)                                                             |
| Keyboard shortcuts, deep links, plugin manifest format, browser-only limitations                                                         | [`USAGE.md`](./USAGE.md)                                                                         |
| The list of pending work, or what a slice actually shipped                                                                               | Internal planning docs (not part of this repo)                                                  |
| How two subsystems talk                                                                                                                  | [`ARCHITECTURE.md`](./ARCHITECTURE.md)                                                           |
| Whether a capability is web, desktop, or hybrid                                                                                          | [`CAPABILITY_MATRIX.md`](./CAPABILITY_MATRIX.md)                                                 |
| Why a non-obvious decision was made                                                                                                      | the matching `*_ADR.md`                                                                          |
| What we test and how                                                                                                                     | [`TEST_PLAN.md`](./TEST_PLAN.md)                                                                 |
| Accessibility quality gate (axe scans, keyboard flows, manual screen-reader checklist)                                                   | [`A11Y.md`](./A11Y.md)                                                                           |
| Bundle/runtime performance budgets and local report workflow                                                                             | [`PERFORMANCE.md`](./PERFORMANCE.md)                                                             |
| Recovery flows (error boundaries, safe mode, factory mode, reset surface)                                                                | [`RECOVERY.md`](./RECOVERY.md)                                                                   |
| Current public readiness audit and launch hardening queue                                                                                | [`PUBLIC_READINESS_AUDIT.md`](./PUBLIC_READINESS_AUDIT.md)                                       |
| Public repository publication checklist                                                                                                  | [`PUBLIC_RELEASE_CHECKLIST.md`](./PUBLIC_RELEASE_CHECKLIST.md)                                   |
| Public release security sign-off                                                                                                         | [`RELEASE_SECURITY.md`](./RELEASE_SECURITY.md)                                                   |
| Third-party license report generated for release evidence                                                                                 | [`THIRD_PARTY_LICENSE_REPORT.md`](./THIRD_PARTY_LICENSE_REPORT.md)                               |
| Dependency modernization baseline and post-sweep hold-back evidence                                                                       | [`build/dep-baseline-2026-05-17.md`](./build/dep-baseline-2026-05-17.md)                         |
| Dated security review packets and remediation evidence                                                                                   | [`security/README.md`](./security/README.md)                                                     |
| Filesystem denylist policy (`BLOCKED_PATHS` families + enforcement)                                                                       | [`security/filesystem-denylist.md`](./security/filesystem-denylist.md)                           |
| License-signing key registry (RFC 7638 thumbprints + rotation SLA the release gate enforces)                                              | [`security/license-key-registry.json`](./security/license-key-registry.json)                     |
| macOS Developer ID signing and notarization setup                                                                                        | [`MACOS_SIGNING.md`](./MACOS_SIGNING.md)                                                         |
| Windows Authenticode signing setup                                                                                                       | [`WINDOWS_SIGNING.md`](./WINDOWS_SIGNING.md)                                                     |
| License + update server observability spec (metrics, alerts, dashboards)                                                                 | [`SERVER_OBSERVABILITY.md`](./SERVER_OBSERVABILITY.md)                                           |
| Operator runbooks (webhook replay, license recovery, refund handling, desktop update draft validation, Electron Stagewright desktop validation, R2 release mirror, update rollback, GitHub degraded, telemetry pipeline) | [`runbooks/`](./runbooks)                                                                        |
| Debugger MVP operator runbook (gutter UX, drawer mount, Settings rows, telemetry, TS source maps)                                        | [`DEBUGGER_SLICE1.md`](./DEBUGGER_SLICE1.md)                                                     |
| Run Capsule test matrix (fixture catalog + dimensions + per-ticket consumption guide for downstream world-class slices)                                | [`CAPSULE_TEST_MATRIX.md`](./CAPSULE_TEST_MATRIX.md)                                              |
| Launch / marketing collateral                                                                                                            | [`press-kit/`](./press-kit), [`seo-pages/`](./seo-pages)                                         |
| Student / classroom lesson drafts                                                                                                        | [`lessons/`](./lessons)                                                                          |

## Operator runbooks

Runbooks are task-oriented how-to guides for live operations. Keep each file
small and procedural; broader rationale belongs in ADRs or release/security
docs.

| Runbook | Use when |
| --- | --- |
| [`desktop-update-draft-validation.md`](./runbooks/desktop-update-draft-validation.md) | Validating draft-channel macOS/Windows update feeds before promotion. |
| [`electron-stagewright-desktop-validation.md`](./runbooks/electron-stagewright-desktop-validation.md) | Running the lightweight Electron Stagewright MCP desktop UI check before falling back to the full native smoke matrix. |
| [`github-degraded.md`](./runbooks/github-degraded.md) | GitHub API, Releases, or webhook paths are degraded and operators need fallback steps. |
| [`license-recovery.md`](./runbooks/license-recovery.md) | Helping a licensed user recover or re-link a license/device. |
| [`r2-release-mirror-setup.md`](./runbooks/r2-release-mirror-setup.md) | Provisioning or validating the public R2 release-download mirror. |
| [`refund-handling.md`](./runbooks/refund-handling.md) | Processing a refund while keeping license and audit records coherent. |
| [`telemetry-pipeline.md`](./runbooks/telemetry-pipeline.md) | Debugging or validating telemetry ingestion and privacy controls. |
| [`update-rollback.md`](./runbooks/update-rollback.md) | Rolling back a bad desktop update or validating rollback feeds. |
| [`webhook-replay.md`](./runbooks/webhook-replay.md) | Replaying Polar/license webhooks safely after a delivery failure. |

## Out of scope for this folder

- `CHANGELOG.md` lives at the repo root because the web + desktop builds
  read it at build time and surface it in the **What's New** overlay.
  It is a product surface, not an engineering doc.
- End-user installation, licensing tours, and feature walkthroughs live
  on linguacode.dev. The terse in-repo end-user reference (shortcuts,
  deep links, plugin format) lives at [`USAGE.md`](./USAGE.md).
- README is a concise entry point at the repo root; the deep contributor
  workflow (dev/test/smoke/build) lives in [`DEVELOPMENT.md`](./DEVELOPMENT.md).
- LICENSE / RELEASE / SECURITY / PRIVACY / CONTRIBUTING /
  THIRD_PARTY_NOTICES live at the repo root because they are npm /
  GitHub / public-release surfaces.

## Conventions

- Use Markdown. Keep line length loose (reflowable by editors).
- Every RL id in any doc must match a tracked `RL-XXX` ticket; never invent new ids.
- When an ADR supersedes another, add a `> Supersedes ADR-XXX` banner
  at the top of the new one and a `> Superseded by ADR-YYY` banner at
  the top of the old one.
- Dates use ISO format (`2026-04-22`) so sort order is correct.
